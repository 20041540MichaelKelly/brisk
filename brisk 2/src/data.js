'use strict';
/*
 * Saved data for Brisk programs: data shapes, save, all, update, remove.
 *
 * The same code runs on the backend (stored in a JSON file) and in the browser
 * (stored on the device), so it must stay self-contained: the page builder turns
 * this function into text and places it in the page.
 *
 * read() returns { next, rows } and write(db) stores it.
 */
function makeData(read, write) {
  var shapes = {};
  var JS_TYPE = { text: 'string', number: 'number', 'yes/no': 'boolean' };
  var EMPTY = { text: '', number: 0, 'yes/no': false, any: null };

  function near(word, list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i], same = 0, len = Math.min(c.length, word.length);
      for (var j = 0; j < len; j++) if (c[j].toLowerCase() === word[j].toLowerCase()) same++;
      if (Math.abs(c.length - word.length) <= 2 && same >= Math.max(c.length, word.length) - 2 && same > 0) return ' Did you mean "' + c + '"?';
    }
    return '';
  }
  function checkValue(shape, key, value) {
    var type = shape.fields[key];
    if (type === undefined) throw new Error(shape.name + ' has no field "' + key + '".' + near(key, Object.keys(shape.fields)));
    var ok = type === 'any' || (type === 'list' ? Array.isArray(value) : typeof value === JS_TYPE[type]);
    if (!ok) throw new Error(shape.name + '.' + key + ' should be ' + (type === 'list' ? 'a list' : type === 'yes/no' ? 'true or false' : type === 'text' ? 'text' : 'a number') + ', but got ' + JSON.stringify(value) + '.');
  }
  function shapeOf(record) {
    var name = record && typeof record.id === 'string' ? record.id.slice(0, record.id.lastIndexOf('-')) : '';
    if (!shapes[name]) throw new Error('That is not a saved record. Use one you got from "all" or "save".');
    return shapes[name];
  }
  function locate(db, shape, id) {
    var rows = db.rows[shape.name] || [];
    for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return i;
    throw new Error('There is no ' + shape.name + ' with the id ' + id + '. It may have been removed.');
  }

  return {
    data: function (name, fields) { shapes[name] = { name: name, fields: fields }; return shapes[name]; },
    save: function (shape, values) {
      var db = read(), row = { id: shape.name + '-' + (db.next++) }, key;
      values = values || {};
      for (key in values) if (key !== 'id') checkValue(shape, key, values[key]);
      for (key in shape.fields) row[key] = key in values ? values[key] : (shape.fields[key] === 'list' ? [] : EMPTY[shape.fields[key]]);
      (db.rows[shape.name] = db.rows[shape.name] || []).push(row);
      write(db);
      return row;
    },
    all: function (shape) { return (read().rows[shape.name] || []).slice(); },
    update: function (record, values) {
      var shape = shapeOf(record), db = read(), row = db.rows[shape.name][locate(db, shape, record.id)], key;
      for (key in values) if (key !== 'id') checkValue(shape, key, values[key]);
      for (key in values) if (key !== 'id') row[key] = values[key];
      write(db);
      return row;
    },
    remove: function (record) {
      var shape = shapeOf(record), db = read();
      db.rows[shape.name].splice(locate(db, shape, record.id), 1);
      write(db);
    },
    rows: function () { return read().rows; }
  };
}

module.exports = { makeData };
