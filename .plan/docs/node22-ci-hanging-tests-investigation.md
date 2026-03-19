# Node 22 CI Hanging Tests Investigation

## Problem summary

Kanban CI started timing out in GitHub Actions after `v0.1.24`.
The most confusing part was that:

- `ubuntu-latest` with Node 20 passed quickly
- `ubuntu-latest` with Node 22 hung
- `macos-latest` with Node 22 hung
- local Node 22 usually passed

This looked like "tests are taking forever", but the real pattern was narrower:
the test output would often finish, then Vitest would never exit.

## Last known good and first bad window

The last green release baseline was `v0.1.24`.
The red CI started in the commits after that release, during the work that added:

- native Cline SDK runtime support
- more task-session integration coverage
- more runtime and terminal test coverage
- file locking changes

The workflow itself was not the main change.
The failure came from new runtime behavior and new tests.

## What made this hard

At first it looked like `runtime-state-stream.integration.test.ts` or `task-command-exit.integration.test.ts` were the cause because they were the longest visible tests in the logs.

That turned out to be only part of the story.
Several different hangs were happening over the course of the investigation, and fixing one exposed the next.

## Investigation timeline

### 1. Web UI test failures were real, but not the Node 22 hang

Early in the rabbit hole, `web-ui` tests were failing because:

- `IntersectionObserver` was missing in JSDOM
- one chat-panel assertion was stale

Those were fixed separately and were not the root cause of the Node 22 root-suite hang.

### 2. Root tests were hanging after output finished

Once the `web-ui` failures were fixed, the main symptom became:

- Node 22 jobs printed all root test files
- no final Vitest summary appeared
- the job sat idle until GitHub canceled it at timeout

This established that the issue was not "one long test body".
It was a process that stayed alive after the useful work was done.

### 3. Child process and IPC cleanup were first suspects

The earliest high-risk tests were:

- `test/integration/runtime-state-stream.integration.test.ts`
- `test/integration/task-command-exit.integration.test.ts`

Those tests spawn real child processes and use pipes and IPC.

We tightened cleanup there by:

- waiting for `close`, not only `exit`
- disconnecting IPC
- unref-ing IPC channels
- destroying stdio streams
- removing listeners after startup and shutdown

This was worth doing, but it did not fully solve the Node 22 hang.

### 4. Added Vitest diagnostics to learn where shutdown stalled

We added:

- a global teardown logger
- a custom Vitest reporter
- a heartbeat that printed active handles and whether the run had reached `onTestRunEnd` or `onFinished`

Important finding:

- on hanging Node 22 jobs, `onInit` printed
- `onTestRunEnd` did not print
- `onFinished` did not print

That meant Vitest was stalling before run finalization, not inside our global teardown.

### 5. Worker and `MessagePort` clues pointed at process coordination

In one stage of the investigation, hanging Node 22 jobs showed live handles like:

- `Socket`
- `MessagePort`

That suggested worker-pool or process-coordination issues rather than a normal assertion failure.

We tried:

- changing worker strategy
- serializing Node 22 CI workers
- upgrading Vitest from 3.x to 4.1.0

These changes altered the shape of the hang and improved isolation, but did not eliminate the final remaining failure.

### 6. Splitting the workflow was the breakthrough

We split the root test step into smaller buckets so CI could tell us which family was still hanging.

That showed:

- `Root tests` passed
- `Runtime API root test` passed
- `Terminal root tests` passed
- `Browser root test` passed
- only `Cline task session service root test` still hung on Node 22

This was the key narrowing step.

### 7. The final isolated suite was `cline-task-session-service.test.ts`

After the workflow split, both Node 22 lanes hung only in:

- `test/runtime/cline-sdk/cline-task-session-service.test.ts`

Important detail from the logs:

- `reporter onInit` printed
- no test result lines from that file printed at all
- no `onTestRunEnd` printed
- active handles included a live `ChildProcess` and `Pipe`

That told us the problem was happening during file startup or early test execution, before per-test cleanup could even help.

### 8. Disposing services after each test was not enough

We added explicit `service.dispose()` cleanup after each test in that file.

That helped the local mental model, but not CI.
The reason is that the hang was happening before `afterEach` mattered.

### 9. Real SDK host startup in a unit-style test was the actual trap

The remaining suite still created real Cline session runtimes.
Those runtimes eventually call:

- `createSessionHost({ backendMode: "local" })`

through:

- `src/cline-sdk/cline-task-session-service.ts`
- `src/cline-sdk/cline-session-runtime.ts`
- `src/cline-sdk/sdk-runtime-boundary.ts`

That means a test file that was mostly asserting Kanban service behavior was also booting the real SDK host.

On local machines and on Node 20 CI, that usually exited quickly enough.
On GitHub Node 22 runners, it could leave a live child process and pipe around long enough to wedge Vitest before the suite reported any results.

## Current takeaway

The important lesson is not "Node 22 is broken".
The better model is:

- our Kanban-specific tests were booting a real SDK subprocess
- local timing and Node 20 timing hid the problem
- GitHub Node 22 runners exposed the lifecycle leak more consistently

## Practical fix direction

For `cline-task-session-service.test.ts`, keep the tests but stop using the real SDK runtime.

That suite should verify Kanban behavior only:

- task-to-session mapping
- summary transitions
- streamed message handling
- turn cancellation
- prompt assembly
- de-duping streamed text vs final text

Those are all Kanban responsibilities.
The SDK should own its own subprocess and session-host tests.

The stable fix is to inject a fake `createSessionRuntime` into `createInMemoryClineTaskSessionService()` so the suite stays fully in-process.

## Why local Node 22 can still pass

This question came up repeatedly and is worth writing down.

Local Node 22 passing does not disprove the bug because CI is a different environment:

- no interactive TTY
- different stdio and pipe behavior
- different timing and CPU scheduling
- different file-system performance
- different process-tree and signal behavior

A race around child-process startup or shutdown can be harmless locally and still hang GitHub Actions.

## Recommended playbook if this happens again

If CI starts hanging after tests appear to finish:

1. Do not assume the slowest visible test is the real cause.
2. Add diagnostics that show whether Vitest reaches `onTestRunEnd`.
3. Inspect active handles and look for `ChildProcess`, `Pipe`, `Socket`, or `MessagePort`.
4. Split the workflow into smaller buckets until one file or family is isolated.
5. Prefer removing real subprocess startup from unit-style tests over adding more teardown logic on top of it.
6. Treat local success as a useful signal, not proof that CI is healthy.

## Files that were most relevant during this investigation

- `test/runtime/cline-sdk/cline-task-session-service.test.ts`
- `src/cline-sdk/cline-task-session-service.ts`
- `src/cline-sdk/cline-session-runtime.ts`
- `src/cline-sdk/sdk-runtime-boundary.ts`
- `test/integration/runtime-state-stream.integration.test.ts`
- `test/integration/task-command-exit.integration.test.ts`
- `test/utilities/child-process.ts`
- `test/vitest-global-teardown.ts`
- `vitest.config.ts`
- `.github/workflows/test.yml`

## Short version for future agents

If Node 22 CI hangs and the tests look "done", suspect a lingering subprocess first.
In this repo, the most expensive rabbit hole came from a Kanban unit-style test accidentally booting the real Cline SDK host.
