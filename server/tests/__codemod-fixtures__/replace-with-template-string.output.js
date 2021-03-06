/*$ { fixture: 'should-convert-literal' } $*/

const a = `foo`;

/*$ { fixture: 'should-convert-var' } $*/

const a = 'bar';
const b = `foo${a}`;

/*$ { fixture: 'should-convert-miltiple-right-vars' } $*/

const a = 'foo';
const b = 'bar';
const c = `baz${b}${a}`;

/*$ { fixture: 'should-convert-miltiple-left-vars' } $*/

const a = 'foo';
const b = 'bar';
const c = `${a}${b}baz`;

/*$ { fixture: 'should-interpret-braces' } $*/

const a = 'foo';
const b = 'bar';
const c = `${a + b}baz`;

/*$ { fixture: 'should-handle-two-literal-expressions' } $*/

const a = 'foo';
const test = `Hello,${a}`;
