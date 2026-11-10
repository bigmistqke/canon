/**
 * The formulas of the sweep: each kind of expression through each position an expression takes, each kind of formula
 * through each position a formula takes, and strings and numbers where they stand, with the readings and the vocabulary
 * they are said in.
 */

export const READINGS = `
noun Owner: owner
noun Cleanup: cleanup
noun String: text
noun univ: thing
Registered: code has registered {1} | code has not registered {1}
Ran: {1} has run | {1} has not run
Disposed: pulse has disposed {1} | pulse has not disposed {1}
Stopped: the dispose of {1} has been stopped | the dispose of {1} has not been stopped
on: {1} is on {2} | {1} is not on {2}
at: {1} waits at {2} | {1} does not wait at {2}
home: {2} is the home of {1} | {2} is not the home of {1}
parent: {2} is the parent of {1} | {2} is not the parent of {1}
name: {1} is named {2} | {1} is not named {2}
tags: {1} is tagged {2} | {1} is not tagged {2}
n: {1} counts {2} | {1} does not count {2}
size: {1} has size {2} | {1} does not have size {2}
gone: {1} is gone | {1} is not gone
owners: {2} owns {1} | {2} does not own {1}
m/Gone: {1} is gone in m | {1} is not gone in m
q: {1} is quiet for {2} | {1} is not quiet for {2}
kept: {1} is kept | {1} is not kept
Labelled: {1} has a label | {1} has no label
Flagged: {1} has a flag | {1} has no flag
Pinned: {1} has a pin | {1} has no pin
Marked: {1} has a mark | {1} has no mark
`;
export const VOCABULARY = `
sig Owner { parent: lone Owner }
sig Cleanup { var on: set Owner, at: lone Owner, home: one Owner, name: one String, tags: set String, n: set Int, size: one Int }
var sig Registered, Ran in Cleanup {}
sig Labelled, Flagged, Pinned, Marked in Cleanup {}
var sig Disposed, Stopped in Owner {}
pred gone[o: Owner] { o in Disposed }
pred gone2[o: Owner] { o in Disposed and o not in Stopped }
fun owners[c: Cleanup]: Owner { c.on }
fun owners2[c: Cleanup]: Owner { c.on + c.at }
let twice[x] = x in Disposed
`;

/** Sets of owners, each written with o, p (Owner) and c (Cleanup) free in it. */
const OWNER_SETS: [string, string][] = [
  ['a variable', 'p'],
  ['a signature', 'Owner'],
  ['a set', 'Disposed'],
  ['a primed set', "Disposed'"],
  ['a navigation of a `one` field', 'c.home'],
  ['a navigation of a `lone` field', 'c.at'],
  ['a navigation of a `set` field', 'c.on'],
  ['a primed navigation', "c.on'"],
  ['a navigation of a primed field', "c.(on')"],
  ['a chain of navigations', 'c.on.parent'],
  ['a navigation over an expression', 'c.(on + at)'],
  ['a navigation from a signature', 'Cleanup.on'],
  ['a box join', 'on[c]'],
  ['a navigation of a transpose', 'p.~parent'],
  ['a navigation of a closure', 'p.^parent'],
  ['a navigation of a reflexive closure', 'p.*parent'],
  ['a union', 'Disposed + Stopped'],
  ['an intersection', 'Disposed & Stopped'],
  ['a difference', 'Owner - Disposed'],
  ['a navigation of a domain restriction', 'c.(Ran <: on)'],
  ['a navigation of a range restriction', 'c.(on :> Disposed)'],
  ['a navigation of an override', 'c.(on ++ (Cleanup -> p))'],
  ['a set comprehension', '{ x: Owner | x in Disposed }'],
  ['`none`', 'none'],
  ['`univ`', 'univ'],
  ['a call of a `fun` with a reading', 'owners[c]'],
  ['a call of a `fun` with no reading', 'owners2[c]'],
  ['a primed expression', "(Disposed + Stopped)'"],
  ['`this/Name`', 'this/Disposed'],
  ['`@Name`', '@Disposed'],
  ['a name of another module', 'm/Gone'],
  ['`if … then … else` of sets', '(p in Disposed implies Disposed else Stopped)'],
];

/** The positions a set of owners takes, with E for the set; o, p: Owner and c: Cleanup are bound. */
const SET_POSITIONS: [string, string][] = [
  ['`o in E`', 'o in E'],
  ['`o not in E`', 'o not in E'],
  ['`not o in E`', 'not o in E'],
  ['`E in Disposed`', 'E in Disposed'],
  ['`E in o`', 'E in o'],
  ['`o = E`', 'o = E'],
  ['`E = o`', 'E = o'],
  ['`o != E`', 'o != E'],
  ['`E = Stopped`', 'E = Stopped'],
  ['`some E`', 'some E'],
  ['`no E`', 'no E'],
  ['`one E`', 'one E'],
  ['`lone E`', 'lone E'],
  ['the type of `all`', 'all x: E | x in Stopped'],
  ['the type of `some`', 'some x: E | x in Stopped'],
  ['an argument of a predicate with a reading', 'gone[E]'],
  ['an argument of a predicate said by its body', 'gone2[E]'],
  ['an argument of `disj`', 'disj[E, Stopped]'],
  ['a count', '#(E) > 1'],
  ['under `always`', 'always o in E'],
  ['primed as a whole', "o in (E)'"],
  ['in a pair on the left of `in`', 'c->o in Cleanup -> (E)'],
];

/** Formulas, with c: Cleanup and o: Owner free in them. */
const FORMULAS: [string, string][] = [
  ['a membership', 'c in Ran'],
  ['a navigation compared', 'c.at = o'],
  ['a call with a reading', 'gone[o]'],
  ['a call said by its body', 'gone2[o]'],
  ['a call of a macro', 'twice[o]'],
  ['`some` of a navigation', 'some c.on'],
  ['`no` of a navigation', 'no c.on'],
  ['an integer comparison', '#c.on > 1'],
  ['`and`', '(c in Ran and o in Disposed)'],
  ['`or`', '(c in Ran or o in Disposed)'],
  ['`implies`', '(c in Ran implies o in Disposed)'],
  ['`iff`', '(c in Ran iff o in Disposed)'],
  ['`implies … else …`', '(c in Ran implies o in Disposed else o in Stopped)'],
  ['`not` of a compound', 'not (c in Ran and o in Disposed)'],
  ['`all`', '(all x: Owner | x in c.on implies x in Disposed)'],
  ['`some`', '(some x: Owner | x in c.on and x in Disposed)'],
  ['`no`', '(no x: Owner | x in c.on and x in Disposed)'],
  ['`one`', '(one x: Owner | x in c.on)'],
  ['`lone`', '(lone x: Owner | x in c.on)'],
  ['`let`', '(let s = c.on | s in Disposed)'],
  ['a block', '{ c in Ran o in Disposed }'],
  ['`always`', '(always c in Ran)'],
  ['`eventually`', '(eventually c in Ran)'],
  ['`after`', '(after c in Ran)'],
  ['`before`', '(before c in Ran)'],
  ['`once`', '(once c in Ran)'],
  ['`historically`', '(historically c in Ran)'],
  ['`until`', '(c in Ran until o in Disposed)'],
  ['`since`', '(c in Ran since o in Disposed)'],
  ['`releases`', '(c in Ran releases o in Disposed)'],
  ['`triggered`', '(c in Ran triggered o in Disposed)'],
  ['`;`', '(c in Ran ; o in Disposed)'],
];

/** The positions a formula takes, with F for the formula; G and H are other formulas. */
const FORMULA_POSITIONS: [string, string][] = [
  ['alone', 'F'],
  ['under `not`', 'not F'],
  ['the first side of `and`', 'F and c in Registered'],
  ['the last side of `and`', 'c in Registered and F'],
  ['a side of `or`', 'c in Registered or F'],
  ['the condition of `implies`', 'F implies c in Registered'],
  ['the consequence of `implies`', 'c in Registered implies F'],
  ['a side of `iff`', 'c in Registered iff F'],
  ['the `else` of `implies … else …`', 'c in Registered implies o in Stopped else F'],
  ['under `always`', 'always F'],
  ['under `after`', 'after F'],
  ['the left of `until`', 'F until c in Registered'],
  ['the right of `until`', 'c in Registered until F'],
  ['the left of `;`', 'F ; c in Registered'],
  ['the body of `all`', 'all d: Cleanup | d in Ran implies F'],
  ['the body of `some`', 'some d: Cleanup | d in Ran and F'],
  ['the body of `let`', 'let s = c.on | o in s and F'],
  ['a line of a block', '{ c in Registered\n F }'],
  ['the body of a predicate', 'pred q[c: Cleanup, o: Owner] { F }'],
];

/** Strings and the positions they take; c: Cleanup and s: String are bound. */
const STRINGS: [string, string][] = [
  ['`one` field = string', 'c.name = "a"'],
  ['string = `one` field', '"a" = c.name'],
  ['`one` field != string', 'c.name != "a"'],
  ['string in `set` field', '"a" in c.tags'],
  ['string not in `set` field', '"a" not in c.tags'],
  ['variable in string', 's in "a"'],
  ['variable not in string', 's not in "a"'],
  ['`not` variable in string', 'not s in "a"'],
  ['`one` field in string', 'c.name in "a"'],
  ['`set` field in string', 'c.tags in "a"'],
  ['`set` field not in string', 'c.tags not in "a"'],
  ['`set` field = string', 'c.tags = "a"'],
  ['variable in a union of strings', 's in "a" + "b"'],
  ['string in string', '"a" in "b"'],
  ['variable = string', 's = "a"'],
  ['string as a call argument', 'gone["a"]'],
  ['`some` of a string', 'some "a"'],
  ['string in `String`', '"a" in String'],
  ['`disj` of a field and a string', 'disj[c.tags, "a"]'],
  ['a quantifier over `String`', 'some t: String | c.name = t'],
];

/** Numbers and the positions they take; c: Cleanup, x, y: Int are bound. */
const NUMBERS: [string, string][] = [
  ['an `Int` variable', 'x'],
  ['a number', '3'],
  ['a negative number', '-3'],
  ['a hexadecimal number', '0x1F'],
  ['a binary number', '0b101'],
  ['`min`', 'min'],
  ['`max`', 'max'],
  ['`fun/min`', 'fun/min'],
  ['`fun/max`', 'fun/max'],
  ['`#` of a navigation', '#c.on'],
  ['`#` of a set', '#Ran'],
  ['`#` of a relation', '#on'],
  ['a `one` `Int` field', 'c.size'],
  ['`sum` of a `set` `Int` field', 'sum c.n'],
  ['`int` of a field', 'int c.n'],
  ['`int[…]`', 'int[c.n]'],
  ['`sum[…]`', 'sum[c.n]'],
  ['`….int`', 'c.n.int'],
  ['`….sum`', 'c.n.sum'],
  ['`sum x: T | …`', '(sum d: Cleanup | #d.on)'],
  ['`plus[…]`', 'plus[x, 1]'],
  ['`minus[…]`', 'minus[x, 1]'],
  ['`mul[…]`', 'mul[x, 2]'],
  ['`div[…]`', 'div[x, 2]'],
  ['`rem[…]`', 'rem[x, 2]'],
  ['`fun/add`', 'x fun/add 1'],
  ['`fun/sub`', 'x fun/sub 1'],
  ['`fun/mul`', 'x fun/mul 2'],
  ['`fun/div`', 'x fun/div 2'],
  ['`fun/rem`', 'x fun/rem 2'],
  ['`x.plus[…]`', 'x.plus[1]'],
  ['a shift `<<`', '(x << 1)'],
  ['a shift `>>`', '(x >> 1)'],
  ['a shift `>>>`', '(x >>> 1)'],
  ['`next` of a variable', 'x.next'],
  ['`fun/next` of a variable', 'x.fun/next'],
];
const NUMBER_POSITIONS: [string, string][] = [
  ['the left of `<`', 'N < y'],
  ['the right of `>`', 'y > N'],
  ['the left of `=<`', 'N =< y'],
  ['the left of `>=`', 'N >= y'],
  ['the left of `=`', 'N = y'],
  ['the left of `!=`', 'N != y'],
  ['the left of `!<`', 'N !< y'],
  ['the left of `not >`', 'N not > y'],
  ['under `not`', 'not N < y'],
  ['as `y in N`', 'y in N'],
  ['as `some N`', 'some N'],
];

/** Every formula of the sweep, with where it comes from. */
export const SWEEP: { what: string; formula: string }[] = [
  ...OWNER_SETS.flatMap(([kind, e]) => SET_POSITIONS.map(([position, shape]) => ({ what: `${kind}, ${position}`, formula: `all c: Cleanup, o, p: Owner | ${shape.replaceAll('E', e)}` }))),
  ...FORMULAS.flatMap(([kind, f]) =>
    FORMULA_POSITIONS.map(([position, shape]) => {
      const body = shape.replace('F', f);
      return { what: `${kind}, ${position}`, formula: body.startsWith('pred') ? body : `all c: Cleanup, o, p: Owner | ${body}` };
    })
  ),
  ...STRINGS.map(([kind, f]) => ({ what: kind, formula: `all c: Cleanup, s: String | ${f}` })),
  ...NUMBERS.flatMap(([kind, n]) => NUMBER_POSITIONS.map(([position, shape]) => ({ what: `${kind}, ${position}`, formula: `all c: Cleanup, x, y: Int | ${shape.replace('N', n)}` }))),
  // `always` around "for every": of sets that never change, of a `var` set, nested, and `disj`, over a rule and over a plain clause.
  ...[
    'always all c: Cleanup | c in Registered implies c in Ran',
    'always all c: Cleanup, o: Owner | (o in c.on and o in Disposed) implies after c in Ran',
    'always all o: Owner | all c: Cleanup | c in Ran implies o in Disposed',
    'always all disj o, p: Owner | o in Disposed implies p not in Disposed',
    'always all c: Registered | c in Ran implies c.on in Disposed',
    'always all c: Cleanup | c in Ran'
  ].map(formula => ({ what: '`always` around "for every"', formula })),
  // "for every" over one thing of a kind: said as "a" and the noun where a rule's first side or a definition's subject
  // first names it, and kept where the words name it once or the rule has an "otherwise".
  ...[
    'all c: Cleanup | c in Ran implies c in Registered',
    'all o: Owner | (o in Disposed and some c: Cleanup | o in c.on) implies o not in Stopped',
    'all c: Cleanup | (c in Registered and c in Ran and some c.on and c.home in Disposed) implies c.home in Stopped',
    'all c: Cleanup | c in Ran implies after c in Registered',
    '(all c: Cleanup | c in Ran implies c in Registered) and (all o: Owner | o in Disposed implies o not in Stopped)',
    'all c: Cleanup | c in Ran implies o in Disposed',
    'all c: Cleanup | c in Ran implies c in Registered else c.home in Stopped',
    'pred gone[o: Owner] { o in Disposed }',
    'pred gone[o: Owner] { o in Disposed and o not in Stopped }'
  ].map(formula => ({ what: '"for every" over one thing of a kind', formula })),
  // "for every" over things of several kinds: said as "a" and each noun where the first side, or a claim said before
  // "when", first names each; kept whole where one of them is named once or keeps its number.
  ...[
    'all c: Cleanup, o: Owner | (o in c.on and o in Disposed) implies c in Ran',
    'all c: Cleanup, o: Owner | (c in Registered and o in Disposed and o in Stopped and c in Ran) implies o in c.on',
    'all c: Cleanup, o: Owner | o in c.on implies o in Disposed',
    'all c, d: Cleanup, o: Owner | (o in c.on and o in d.on) implies o in Disposed'
  ].map(formula => ({ what: '"for every" over things of several kinds', formula })),
  // Two rules that go each way: one equivalence; and a rule beside one that does not go back, two rules.
  ...[
    'all c: Cleanup | (c in Ran implies c in Registered) and (c in Registered implies c in Ran)',
    'all o: Owner | (o in Disposed implies (o in Stopped or some c: Cleanup | o in c.on)) and ((o in Stopped or some c: Cleanup | o in c.on) implies o in Disposed)',
    'all c: Cleanup | (c in Ran implies c in Registered) and (c in Registered implies c.on in Disposed)'
  ].map(formula => ({ what: 'two rules that go each way', formula })),
  // A "some" over several things: a thing said inside the clauses that name it where they make a noun phrase, and kept above them where they do not.
  ...[
    'some c: Cleanup, o: Owner | c in Registered and o in c.on and o in Disposed',
    'some c: Cleanup, o: Owner | c in Ran and o in c.on and o in Disposed',
    'some c: Cleanup, o: Owner | c in Ran and o in c.on and o in Disposed and o in Stopped',
    'some c: Cleanup, o: Owner | o in c.on and c in Ran and c in Registered and o in Disposed and o in Stopped',
    'some c, d: Cleanup, o: Owner | c in Ran and o in c.on and d in Registered and o in d.on',
    // A thing that must differ from another stays where "another" names the thing it differs from.
    'some o, p, q: Owner | o != q and p in o.parent and q in p.parent and q in Disposed'
  ].map(formula => ({ what: 'a thing of a "some" inside its clauses', formula })),
  // Conditions of a noun phrase with the thing at their end that share their subject: "an owner that pulse has disposed and disposes".
  ...['some o: Owner | o in c.on and o in Disposed and dispose[o]', 'some o: Owner | o in c.on and o in Disposed and o not in Stopped'].map(formula => ({ what: 'relative clauses that share their subject', formula })),
  // Negative clauses about one subject that share its verb, each with a noun phrase of its own: "none of these".
  ...['all c: Cleanup | c not in Labelled and c not in Flagged and c not in Pinned and c not in Marked'].map(formula => ({ what: 'negative clauses that share their verb', formula })),
  // `some` over several things, of one type and of two.
  ...['some c: Cleanup, o: Owner | o in c.on and o in Disposed', 'some disj c, d: Cleanup | c in Ran and d not in Ran', 'some c: Cleanup, o, p: Owner | o in c.on and p not in c.on'].map(formula => ({ what: '`some` over several things', formula })),
  // A quantifier about its variable alone, with nothing else to hang from: "there is a cleanup that has run".
  ...['some d: Cleanup | d in Ran', 'no d: Cleanup | d in Ran'].map(formula => ({ what: 'a quantifier about its variable alone', formula })),
  // Two things of one kind that differ, each with a condition of its own: "is on an owner and is on another owner".
  ...['all c: Cleanup | some disj o, p: Owner | o in c.on and p in c.on', 'all c: Cleanup | some o, p: Owner | o != p and o in c.on and p in Disposed'].map(formula => ({ what: 'two things of a kind', formula })),
  // A definition whose alternatives each begin with a kind: of kinds that share no member, of one kind, and with a clause not about its subject.
  ...['pred kept[x: univ] { (x in Owner and gone[x]) or (x in Cleanup and x in Ran) }', 'pred kept[x: univ] { x in Cleanup and x in Ran }', 'pred kept[x: univ] { (x in Owner and gone[x]) or (x in Cleanup and x in Ran and x not in Registered) }'].map(formula => ({ what: 'a definition by kinds', formula }))
];
