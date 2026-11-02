import { expect, test } from "vitest";
import { classifyOperation, continueRefusal } from "./operation";

test("a cherry-pick can continue once its files are merged and can be skipped", () => {
  const paused = classifyOperation({
    cherryPick: true,
    merge: false,
    revert: false,
    rebase: false,
    conflicted: ["src/app.ts"],
    subject: "feat: api",
    remaining: 2
  });
  expect(paused?.kind).toBe("cherry-pick");
  expect(paused?.canSkip).toBe(true);
  expect(paused?.canContinue).toBe(false);
  expect(continueRefusal(paused)).toBe("Resolve and stage the conflicted files first: src/app.ts.");

  const clear = classifyOperation({
    cherryPick: true,
    merge: false,
    revert: false,
    rebase: false,
    conflicted: [],
    subject: "feat: api",
    remaining: 2
  });
  expect(clear?.canContinue).toBe(true);
  expect(continueRefusal(clear)).toBeNull();
});

test("a merge can continue and cannot skip", () => {
  const merge = classifyOperation({
    cherryPick: false,
    merge: true,
    revert: false,
    rebase: false,
    conflicted: [],
    subject: "Merge branch feature"
  });
  expect(merge?.kind).toBe("merge");
  expect(merge?.canContinue).toBe(true);
  expect(merge?.canSkip).toBe(false);
});

test("unmerged files without a head are a squash, and rebase wins over a cherry-pick", () => {
  const squash = classifyOperation({
    cherryPick: false,
    merge: false,
    revert: false,
    rebase: false,
    conflicted: ["README.md"]
  });
  expect(squash?.kind).toBe("squash");
  expect(squash?.canContinue).toBe(false);
  expect(squash?.canAbort).toBe(true);

  const rebase = classifyOperation({
    cherryPick: true,
    merge: false,
    revert: false,
    rebase: true,
    conflicted: ["README.md"]
  });
  expect(rebase?.kind).toBe("rebase");
  expect(rebase?.canSkip).toBe(false);
  expect(rebase?.canContinue).toBe(false);
});
