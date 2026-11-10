/** The passes, in the order they run. */
import type { Pass } from '../pass.ts';
import { claimFirst, clausesInASentence, exactlyWhen, ruleOnOneLine, timePhraseInFront } from './layout.ts';
import { forEveryTogether, rulesAsEquivalence } from './merge.ts';
import { exactlyOne, negationInward } from './negate.ts';
import { alwaysInsideForEvery, fromNowOnWhenever, untilInASentence } from './time.ts';
import { conditionsApart, thereIsAThat, xAndNoOther } from './subject.ts';
import { anotherOfAKind, definitionByKinds, nounPhrases, someInside } from './phrases.ts';
import { noneOfThese } from './shared.ts';

export const PASSES: readonly Pass[] = [
  negationInward,
  exactlyOne,
  rulesAsEquivalence,
  alwaysInsideForEvery,
  xAndNoOther,
  forEveryTogether,
  conditionsApart,
  anotherOfAKind,
  someInside,
  nounPhrases,
  definitionByKinds,
  thereIsAThat,
  untilInASentence,
  timePhraseInFront,
  clausesInASentence,
  noneOfThese,
  exactlyWhen,
  ruleOnOneLine,
  fromNowOnWhenever,
  claimFirst,
  { name: 'lone-numbers-dropped', spec: 'spec-a-variable-alone-of-its-noun-is-named-the-noun', print: { dropLoneNumbers: true } },
  { name: 'a-noun-for-every', spec: 'spec-a-for-every-over-the-noun-alone-is-said-as-a-noun-where-the-words-first-name-it', print: { aNounForEvery: true } },
  { name: 'short-names', spec: 'spec-a-variable-is-named-after-its-noun-and-its-number', print: { shortNames: true } }
];
