function Query (model) {
    this._query = '';
    this._queryType = '';
    this._table = model.table;
    this._model = model;
    this._lastAdded = '';
    this.sections = {
        columns: '',
        escaped: '',
        values: '',
        where: '',
        orderBy: '',
        limit: ''
    }
    this._canHave = {
        select: ['where','orderBy','limit'],
        update: ['escaped', 'where'],
        insert: ['columns', 'escaped', 'where'],
        delete: ['where'],
        raw: []
    }
}

Query.prototype.create = function() {
    let permitted = this._permittedSections(this._queryType)

    this._fillBlanks();

    for (let i = 0; i < permitted.length; i++) {
        const key = permitted[i];
        const section = this.sections[key];

        if (section.length) {
            this.addRawToQuery(section);
        }
    }

    try {
        this._checkForErrors();
    } catch (e) {
        return e;
    }
    
    if (this.sections.escaped) {
        return [this._query, this.sections.values];
    }
    return this._query;
}


// Main Body
Query.prototype.select = function() {
    this._queryType = 'select';
    this.sections.columns = this._model.getAliasedFields();
    return this._startNewQuery(`SELECTcolumns FROM ${this._table} `);
}
Query.prototype.update = function() {
    this._queryType = 'update';
    return this._startNewQuery(`UPDATE ${this._table} SET `);
}

Query.prototype.insert = function() {
    this._queryType = 'insert';
    return this._startNewQuery(`INSERT INTO ${this._table} `);
}

Query.prototype.delete = function() {
    this._queryType = 'delete';
    return this._startNewQuery(`DELETE FROM ${this._table} `);
}

Query.prototype.raw = function(query) {
    this._queryType = 'raw';
    return this._startNewQuery(query);
}


// Modifiers

Query.prototype.where = function(...params) {
    let keyWord = this._detectIfExists("WHERE") ? "AND" : "WHERE";
    let row = params[0];
    let value = params.length > 2 ? params[2] : params[1];
    let modifier = params.length > 2 ? params[1] : '=';
    this.sections.where += `${keyWord} ${row} ${modifier} ${this._parseValue(value)} `;

    return this;
}

Query.prototype.whereIn = function(row, value) {
    let keyWord = this._detectIfExists("WHERE") ? "AND" : "WHERE";
    this.sections.where += `${keyWord} ${row} IN ${value} `;

    return this;
}

Query.prototype.setValues = function(data) {
    let columns = Object.keys(data);
    let values = Object.values(data);

    this.sections.columns = `(${columns.join(', ')}) `;
    this.sections.escaped = this._queryType === 'insert' ? `VALUES (${values.map(e => '?').join(', ')}) ` : this._buildUpdateValues(columns);
    this.sections.values = values.map(e => {
        if (e && (Object.getPrototypeOf(e) === Object.prototype || Array.isArray(e))) {
            return JSON.stringify(e);
        }
        return e;
    });

    return this;
}

Query.prototype.orderBy = function(column, order = "ASC") {
    this.sections.orderBy += `ORDER BY ${column} ${order} `;

    return this;
}

Query.prototype.only = function(columns) {
    this.sections.columns = ' ' + this._table + '.' + columns.join(`, ${this._table}.`)
    return this;
}

Query.prototype.except = function(columns) {
    this.sections.columns = this.sections.columns.filter(e => {
        
        for (let i = 0; i < columns.length; i++) {
            const column = columns[i];
            if (e.includes(column)) {
                return false;
            }
        }
        
        return e;
    })
}

Query.prototype.distinct = function() {
    this._query = this._query.replace('SELECT', 'SELECT DISTINCT')
    return this;
}

Query.prototype.limit = function(limit, offset = 0) {
    this.sections.limit = `LIMIT ${offset}, ${limit}`;
}

Query.prototype.paginate = function(page, page_length) {
    let query_limit = (page - 1) * page_length;
    this.limit(page_length, query_limit);
    
    return this;
}

Query.prototype.whereInPivot = function({pivot, table1, table2, column, value, joinColumn, filterBy}) {
    let values = `'${value}'`;

    if (Array.isArray(values)) {
        values.map(e => `'${e}'`)
        values = values.join(', ');
    }
    this.whereIn('id', `(SELECT t1.${joinColumn} FROM ${pivot} as t1 LEFT JOIN ${table2} as t2 ON t2.id = t1.${column} WHERE t2.${filterBy} IN (${values}))`);

    return this;
}


// Helper functions

Query.prototype._startNewQuery = function(str) {
    this._query = str;
    this._lastAdded = str;
    return this;
}

Query.prototype.addRawToQuery = function(str) {
    this._query += str;
    this._lastAdded = str;
    return this;
}

Query.prototype._detectIfExists = function(word) {
    return this.sections[word.toLowerCase()];
}

Query.prototype._parseValue = function(val) {
    let parsedVal = null;
    let type = typeof val;

    if (val !== null && val !== undefined) {
        if (val === Object(val)) {
            parsedVal = `'${JSON.stringify(val)}'`;
        } else if (type !== 'number' && val !== 'NULL') {
            parsedVal = `"${val.trim()}"`
        } else {
            parsedVal = val;
        }
    }

    return parsedVal;
}

Query.prototype._parseMulti = function (values) {
    return values.map(e => this._parseValue(e));
}

Query.prototype._checkForErrors = function() {
    const mustHave = {
        select: [],
        update: ['values'],
        insert: ['values'],
        delete: ['where'],
        raw: []
    }

    const cantHave = {
        select: ['values'],
        update: [],
        insert: [],
        delete: ['columns', 'values'],
        raw: []
    }

    for (let i = 0; i < mustHave[this._queryType].length; i++) {
        const section = mustHave[this._queryType][i];
        
        if (!this._sectionExists(section)) {
            throw new Error(`"${section}" missing in query.`)
        }
    }

    for (let i = 0; i < cantHave[this._queryType].length; i++) {
        const section = cantHave[this._queryType][i];
        
        if (this._sectionExists(section)) {
            throw new Error(`"${section}" cannot be in query.`)
        }
    }

    return false;
}

Query.prototype._sectionExists = function(section) {
    return !!this.sections[section].length;
}

Query.prototype._permittedSections = function() {
    return this._canHave[this._queryType];
}

Query.prototype._fillBlanks = function() {
    const sections = Object.keys(this.sections);
    
    for (let i = 0; i < sections.length; i++) {
        const section = sections[i];
        if (this._query.includes(section)) {
            this._query = this._query.replace(section, this.sections[section])
        }
    }
}

Query.prototype._buildUpdateValues = function(columns) {
    let str = '';
    
    for (let i = 0; i < columns.length; i++) {
        const column = columns[i];
        str += `${column} = ?, `
    }

    str = str.slice(0, str.length - 2) + ' ';

    return str;
}


module.exports = Query;