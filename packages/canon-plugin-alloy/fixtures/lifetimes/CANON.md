# Canon: lifetimes, with a logic layer

Six specs of pulse's lifetimes canon, each with the Alloy predicate that states it. The terms below declare the model they share, and their readings say it in words, so the statement of each spec is written from its predicate by `canon generate`.

Five of the specs have the id of a unit in pulse's own `CANON.md`, and say everything that unit says. The first, `disposing-an-owner-runs-its-cleanups`, is the example's own. It restates the sentence of pulse's `disposing-an-owner-ends-what-it-owns` about cleanups. It leaves out the effects and computeds that stop, and the signals that keep working. The spec about sub-owners is one of three sub-specs of pulse's `an-owner-disposes-its-children-before-its-own-cleanups`. The other two, about effects and computeds, are not modeled.

## @term owner

> An owner is a scope of pulse that holds cleanups and sub-owners, and that pulse disposes once.

An owner sits under its parent, and the nearest owner above it that is an error handler or a boundary takes the errors of its cleanups. Owners of one parent are created in an order.

<details>
<summary>Alloy</summary>

```alloy vocabulary
sig Owner { parent: lone Owner, handler: lone Owner }
sig Handler in Owner {}
var sig Disposed in Owner {}
var sig Entering in Owner {}
var sig Threw in Owner {}
var sig Redisposed in Owner {}
var sig Stopped in Owner {}
one sig Birth { order: Owner -> Owner }

fact tree { no o: Owner | o in o.^parent }
fact nearest_handler { all o: Owner | o.handler = { h: Handler | h in o.^parent and no g: Handler | g in o.^parent and h in g.^parent } }
fact creation_order { no o: Owner | o->o in Birth.order  all a, b, c: Owner | (a->b in Birth.order and b->c in Birth.order) implies a->c in Birth.order }
fact siblings_have_an_order { all a, b: Owner | (a != b and some a.parent and a.parent = b.parent) implies (a->b in Birth.order or b->a in Birth.order) }
```

| reading     | holds                                                  | does not hold                                              |
| ----------- | ------------------------------------------------------ | ---------------------------------------------------------- |
| Disposed    | pulse has disposed {1}                                 | pulse has not disposed {1}                                 |
| parent | {2} ^is^ the parent of {1} |  |
| handler | {2} ^is^ the nearest error handler or boundary above {1} |  |
| Threw       | the dispose of {1} has thrown                          | the dispose of {1} has not thrown                          |
| Stopped     | the dispose of {1} has been stopped                    | the dispose of {1} has not been stopped                    |
| Birth.order | {1} was created before {2}                             | {1} was not created before {2}                             |

</details>

## @term cleanup

> A cleanup is a function that code registers on an owner, and that pulse runs when it disposes the owner.

Code registers each cleanup once, and the order of registering is the order the cleanups keep.

<details>
<summary>Alloy</summary>

```alloy vocabulary
sig Cleanup { var on: lone Owner, var reached: lone Owner }
var sig Registered, Ran in Cleanup {}
one sig Clock { var older: Cleanup -> Cleanup }
```

| reading     | holds                            | does not hold                        |
| ----------- | -------------------------------- | ------------------------------------ |
| Registered  | code has registered {1}          | code has not registered {1}          |
| Ran         | {1} has run                      | {1} has not run                      |
| on | {1} ^is^ on {2} |  |
| Clock.older | code registered {1} before {2}   | code did not register {1} before {2} |
| reached     | the error of {1} has reached {2} | the error of {1} has not reached {2} |

</details>

### @term failing-cleanup

> A failing cleanup is a cleanup that throws when it runs.

<details>
<summary>Alloy</summary>

```alloy vocabulary
sig Failing in Cleanup {}
```

</details>

## @term teardown-model

> A teardown is the trace of what pulse does when it disposes an owner.

The model the specs share: each step registers, disposes, runs, enters or reports, and leaves the rest as it was. A name with no reading is said by its own predicate, and the statement of each unit below is said from its predicate.

<details>
<summary>Alloy</summary>

```alloy vocabulary
var sig Throwing {}

fact init { no Registered and no Ran and no Disposed and no Entering and no Throwing and no Threw and no Redisposed and no Stopped and no on and no reached and no Clock.older }

pred quiet { no Entering' and no Throwing' }
pred kept { reached' = reached and Threw' = Threw and Redisposed' = Redisposed and Stopped' = Stopped }
pred register[c: Cleanup, o: Owner] {
  c not in Registered  Registered' = Registered + c  on' = on + c->o
  Clock.older' = Clock.older + (Registered -> c)
  Ran' = Ran  Disposed' = Disposed  kept  quiet }
pred dispose[o: Owner] {
  o not in Disposed  no (o.parent & Stopped)  Disposed' = Disposed + o
  Registered' = Registered  Ran' = Ran  on' = on  Clock.older' = Clock.older  kept  quiet }
pred runIt[c: Cleanup] {
  c in Registered - Ran  no (c.on & Stopped)  Ran' = Ran + c
  Registered' = Registered  Disposed' = Disposed  on' = on  Clock.older' = Clock.older  kept  quiet }
pred enter[o: Owner] {
  Entering' = o
  Registered' = Registered  Ran' = Ran  Disposed' = Disposed  on' = on  Clock.older' = Clock.older  kept }
-- code disposes an owner that pulse disposed, and that call runs a cleanup of the owner
pred runByCall[c: Cleanup, o: Owner] {
  o in Disposed  c in Registered - Ran  c.on = o  Ran' = Ran + c  Redisposed' = Redisposed + o
  Registered' = Registered  Disposed' = Disposed  on' = on  Clock.older' = Clock.older  reached' = reached  Threw' = Threw  Stopped' = Stopped  quiet }
-- code disposes an owner that pulse disposed, and that call runs nothing
pred disposeAgain[o: Owner] {
  o in Disposed  Redisposed' = Redisposed + o  Ran' = Ran
  Registered' = Registered  Disposed' = Disposed  on' = on  Clock.older' = Clock.older  reached' = reached  Threw' = Threw  Stopped' = Stopped  quiet }
-- code disposes an owner that pulse disposed, and that call throws
pred throwByCall[o: Owner] {
  o in Disposed  Redisposed' = Redisposed + o  Threw' = Threw + o  Ran' = Ran
  Registered' = Registered  Disposed' = Disposed  on' = on  Clock.older' = Clock.older  reached' = reached  Stopped' = Stopped  quiet }
-- the error of a cleanup that failed reaches a handler or boundary
pred report[c: Cleanup, h: Owner] {
  c in Failing  c in Ran  no c.reached  h in Handler  reached' = reached + c->h  Threw' = Threw  Redisposed' = Redisposed  Stopped' = Stopped
  Registered' = Registered  Ran' = Ran  Disposed' = Disposed  on' = on  Clock.older' = Clock.older  quiet }
-- the error of a cleanup that failed leaves through the dispose of its owner, which throws
pred escape[c: Cleanup] {
  c in Failing  c in Ran  no c.reached  c.on in Disposed  c.on not in Threw  Threw' = Threw + c.on  reached' = reached  Redisposed' = Redisposed  Stopped' = Stopped
  Registered' = Registered  Ran' = Ran  Disposed' = Disposed  on' = on  Clock.older' = Clock.older  quiet }
-- the error of a cleanup that failed stops the dispose of its owner: the other cleanups do not run and the children are not disposed
pred stop[c: Cleanup] {
  c in Failing  c in Ran  c.on in Disposed  c.on not in Stopped  Stopped' = Stopped + c.on  reached' = reached  Threw' = Threw  Redisposed' = Redisposed
  Registered' = Registered  Ran' = Ran  Disposed' = Disposed  on' = on  Clock.older' = Clock.older  quiet }
pred idle { Registered' = Registered Ran' = Ran Disposed' = Disposed on' = on Clock.older' = Clock.older kept quiet }
fact each_step { always (idle or (some c: Cleanup, o: Owner | register[c,o] or dispose[o] or runIt[c] or runByCall[c,o] or disposeAgain[o] or throwByCall[o] or enter[o] or (some h: Owner | report[c,h]) or escape[c] or stop[c])) }
fact registers_once { always all c: Cleanup | register[c, Owner] implies after always not register[c, Owner] }
fact entering_throws_only { always (some Throwing' implies some Entering') }

pred runNow[c: Cleanup] { c not in Ran and c in Ran' }
```

| reading     | holds                                                                                                                             | does not hold                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Throwing' | right after, a call ^is^ throwing | right after, no call is throwing |
| dispose | pulse ^disposes^ {1} |  |
| enter | a call ^enters^ {1} |  |
| runNow | {1} ^runs^ |  |
| runByCall | code ^disposes^ {2} after pulse disposed it, and that call runs {1}, a cleanup that code has registered on {2} and that has not run | it is not so that code disposes {2} after pulse disposed it and that call runs {1} |
| throwByCall | code ^disposes^ {1} after pulse disposed it, and that call throws | it is not so that code disposes {1} after pulse disposed it and that call throws |

```alloy bounds
for 3 but 1..8 steps
```

</details>

A teardown the specs must allow: a cleanup of an owner fails while pulse disposes the owner, and its error reaches the nearest error handler or boundary above the owner.

<!-- statement-scenario-1-term-teardown-model:begin — generated by `canon generate`; edits are overwritten -->
> It must be possible that:
>
> For some [*owner*](#term-owner) O1, some owner O2 and some [*failing cleanup*](#term-failing-cleanup):\
> all of these hold:
> - owner O2 is the nearest error handler or boundary above owner O1
> - now or later, all of these hold:
>   - pulse disposes owner O1
>   - the failing cleanup is on owner O1
>   - now or later, all of these hold:
>     - the failing cleanup runs
>     - now or later, the error of the failing cleanup has reached owner O2
<!-- statement-scenario-1-term-teardown-model:end -->

<details>
<summary>Alloy</summary>

```alloy scenario
some o, h: Owner, c: Failing | o.handler = h and eventually (dispose[o] and c.on = o and eventually (runNow[c] and eventually c.reached = h))
```

</details>

### @spec disposing-an-owner-runs-its-cleanups

<!-- statement-spec-disposing-an-owner-runs-its-cleanups:begin — generated by `canon generate`; edits are overwritten -->
> From now on, for every [*owner*](#term-owner) and every [*cleanup*](#term-cleanup):\
> when all of these hold:
> - pulse disposes the owner
> - code has registered the cleanup
> - the cleanup is on the owner
> - the cleanup has not run
>
> then now or later, the cleanup has run.
<!-- statement-spec-disposing-an-owner-runs-its-cleanups:end -->

Disposing an owner is how its cleanups get their turn. When pulse disposes the owner, every cleanup that code has registered on it runs sooner or later, unless it has already run. Pulse leaves none behind.

<details>
<summary>Alloy</summary>

```alloy
always all o: Owner, c: Cleanup |
  (dispose[o] and c in Registered and c.on = o and c not in Ran) implies eventually c in Ran
```

</details>

### @spec dispose-runs-once

<!-- statement-spec-dispose-runs-once:begin — generated by `canon generate`; edits are overwritten -->
> All of these hold:
> - from now on, there is no combination of [*cleanup*](#term-cleanup) C1 and [*owner*](#term-owner) O1 such that code disposes owner O1 after pulse disposed it, and that call runs cleanup C1, a cleanup that code has registered on owner O1 and that has not run
> - from now on, there is no owner O2 such that code disposes owner O2 after pulse disposed it, and that call throws
<!-- statement-spec-dispose-runs-once:end -->

Disposing an owner a second time is harmless. When code disposes an owner that pulse has already disposed, the call runs none of its cleanups and does not throw.

<details>
<summary>Alloy</summary>

```alloy
(always no c: Cleanup, o: Owner | runByCall[c, o])
and
(always no o: Owner | throwByCall[o])
```

</details>

### @spec owner-cleanups-run-newest-first-and-in-isolation

<!-- statement-spec-owner-cleanups-run-newest-first-and-in-isolation:begin — generated by `canon generate`; edits are overwritten -->
> All of these hold:
> - from now on, for every [*owner*](#term-owner) O1, every [*cleanup*](#term-cleanup) C1 and every cleanup C2:\
>   when all of these hold:
>   - pulse disposes owner O1
>   - code has registered cleanup C1
>   - cleanup C1 has not run
>   - code has registered cleanup C2
>   - cleanup C2 has not run
>   - cleanup C1 is on owner O1
>   - cleanup C2 is on owner O1
>   - code registered cleanup C1 before cleanup C2
>
>   then the following holds:\
>   cleanup C2 runs now or later, and until then, cleanup C1 does not run
> - from now on, for every owner O2 and every [*failing cleanup*](#term-failing-cleanup):\
>   when the failing cleanup runs, is on owner O2 and pulse has disposed owner O2, then from now on, the dispose of owner O2 has not been stopped.
<!-- statement-spec-owner-cleanups-run-newest-first-and-in-isolation:end -->

An owner's cleanups unwind like a stack: the one registered last runs first. Each runs in isolation, so a cleanup that fails does not stop the dispose.

<details>
<summary>Alloy</summary>

```alloy
(always all o: Owner, c, d: Cleanup |
  (dispose[o] and c + d in Registered - Ran and c.on = o and d.on = o and c->d in Clock.older)
  implies ((not runNow[c]) until runNow[d]))
and
(always all o: Owner, c: Failing |
  (runNow[c] and c.on = o and o in Disposed) implies always o not in Stopped)
```

</details>

### @spec a-disposed-owner-cannot-be-entered

<!-- statement-spec-a-disposed-owner-cannot-be-entered:begin — generated by `canon generate`; edits are overwritten -->
> For every [*owner*](#term-owner):\
> from now on, whenever a call enters the owner and pulse has disposed the owner, then right after, a call is throwing.
<!-- statement-spec-a-disposed-owner-cannot-be-entered:end -->

A disposed owner is finished. A call that tries to enter it throws at once.

<details>
<summary>Alloy</summary>

```alloy
always all o: Owner | (enter[o] and o in Disposed) implies some Throwing'
```

</details>

### @spec an-owner-disposes-its-sub-owners-before-its-own-cleanups

<!-- statement-spec-an-owner-disposes-its-sub-owners-before-its-own-cleanups:begin — generated by `canon generate`; edits are overwritten -->
> All of these hold:
> - from now on, for every [*owner*](#term-owner) O1, every owner O2 and every [*cleanup*](#term-cleanup):\
>   when all of these hold:
>   - pulse disposes owner O1
>   - owner O1 is the parent of owner O2
>   - pulse has not disposed owner O2
>   - code has registered the cleanup
>   - the cleanup has not run
>   - the cleanup is on owner O1
>
>   then the following holds:\
>   pulse disposes owner O2 now or later, and until then, the cleanup does not run
> - from now on, for every owner O3, every owner O4 and every owner O5:\
>   when all of these hold:
>   - pulse disposes owner O3
>   - owner O3 is the parent of owner O4
>   - owner O3 is the parent of owner O5
>   - owner O4 was created before owner O5
>   - pulse has not disposed owner O4
>   - pulse has not disposed owner O5
>
>   then the following holds:\
>   pulse disposes owner O5 now or later, and until then, pulse does not dispose owner O4.
<!-- statement-spec-an-owner-disposes-its-sub-owners-before-its-own-cleanups:end -->

An owner tears down from the inside out. Pulse disposes each of its children before it runs any cleanup registered on the owner, so a cleanup never finds a child still alive. The children go newest first, like the cleanups.

<details>
<summary>Alloy</summary>

```alloy
(always all o, k: Owner, c: Cleanup |
  (dispose[o] and k.parent = o and k not in Disposed and c in Registered - Ran and c.on = o)
  implies ((not runNow[c]) until dispose[k]))
and
(always all o, j, k: Owner |
  (dispose[o] and j.parent = o and k.parent = o and j->k in Birth.order and j not in Disposed and k not in Disposed)
  implies ((not dispose[j]) until dispose[k]))
```

</details>

### @spec a-throwing-owner-cleanup-is-reported

<!-- statement-spec-a-throwing-owner-cleanup-is-reported:begin — generated by `canon generate`; edits are overwritten -->
> All of these hold:
> - from now on, for every [*owner*](#term-owner) O1 and every [*failing cleanup*](#term-failing-cleanup) FC1:\
>   when failing cleanup FC1 runs, is on owner O1 and pulse has disposed owner O1, then from now on, the dispose of owner O1 has not thrown
> - from now on, for every owner O2, every owner O3 and every failing cleanup FC2:\
>   when all of these hold:
>   - failing cleanup FC2 runs
>   - failing cleanup FC2 is on owner O2
>   - pulse has disposed owner O2
>   - owner O3 is the nearest error handler or boundary above owner O2
>
>   then now or later, the error of failing cleanup FC2 has reached owner O3.
<!-- statement-spec-a-throwing-owner-cleanup-is-reported:end -->

A cleanup that throws while its owner is disposed does not make the dispose throw. Its error goes where errors go in pulse: to the nearest error handler or boundary above the owner.

<details>
<summary>Alloy</summary>

```alloy
(always all o: Owner, c: Failing |
  (runNow[c] and c.on = o and o in Disposed) implies always o not in Threw)
and
(always all o, h: Owner, c: Failing |
  (runNow[c] and c.on = o and o in Disposed and o.handler = h) implies eventually c.reached = h)
```

</details>

