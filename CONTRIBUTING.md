# 🛠️ Contributing Guide

Thank you for your interest in contributing to **budget-alerts**!
This document explains how to work with the codebase, how the architecture is structured, how to run tests, and how to submit high-quality contributions.

---

# 📦 Project Structure Overview

```
bin/
  budget-alerts.ts            # CDK app / entry point
  init-budget-config.ts       # CLI for config initialization & sync

lib/
  budget-alerts-stack.ts      # Main CDK stack using StackSets
  org-loader.ts               # AWS Organizations discovery logic
  budget-config-loader.ts     # YAML config I/O + validation helpers
  planner/
    index.ts
    build-ou-tree.ts
    compute-effective-budgets.ts
    compute-homogeneous-subtrees.ts
    select-ou-budget-attachments.ts
    # ↑ All pure deterministic planning logic

test/
  # Jest tests (unit tests only)
```

---

# ✨ Architectural Principles

**🚫 DO NOT violate these rules. This project depends heavily on predictability.**

### 1. The _planner_ is pure and deterministic

All modules in `lib/planner/` MUST:

- contain **no AWS SDK calls**
- avoid reading the filesystem
- avoid environment access
- avoid time-based behavior
- avoid randomization

They must take **inputs → outputs** and be fully testable.

### 2. No business logic in CDK constructs

`budget-alerts-stack.ts` must only:

- evaluate planner results
- wire CDK constructs and StackSets
- pass validated data to resources

### 3. Validation is performed **before** CDK synthesis

`validateBudgetConfig()` must prevent invalid OU IDs or malformed config from ever reaching stack synthesis.

### 4. The repo must remain **publishable as an npm package**

In particular:

- TypeScript sources must compile cleanly via `npm run build`
- No hard-coded organization ID
  (this is resolved dynamically via the custom resource)

### 5. No test-breaking rewrites

Functions under test must NOT be replaced or stubbed merely to satisfy tests.
Refactors that change core logic require explicit architectural review.

---

# 🚀 Development Setup

## Clone and install dependencies

```bash
git clone <repo>
cd budget-alerts
npm install
```

## Build TypeScript → JavaScript

```bash
npm run build
```

## Run the CDK app locally (TS mode)

```bash
npx cdk synth
```

CDK uses:

```jsonc
"app": "npx ts-node --prefer-ts-exts bin/budget-alerts.ts"
```

so you can run live TypeScript during development.

---

# 🧪 Testing

Unit tests are located in `test/`.

Run them via:

```bash
npm test
```

Tests focus on:

- Organizational Unit tree building
- Effective budget calculation
- Homogeneous subtree detection
- Stack attachment selection

The entire planner layer is fully unit-testable.

### ❗Important

Tests MUST NOT rely on live AWS calls.
Use fixture OU trees and config objects only.

---

# 🔧 Running the Config Sync CLI During Development

The development version uses TypeScript directly:

```bash
npm run config
```

This runs:

```bash
ts-node --transpile-only bin/init-budget-config.ts
```

Production users will instead use the packaged version:

```bash
npx budget-alerts-init-config
```

---

# 🧬 Making Changes

## 1. Planner logic (lib/planner/\*)

Changes must:

- be **pure functions**
- include **unit tests** for new behaviors
- avoid dependencies outside the planner folder
- receive architectural approval if changing core algorithm flow

## 2. Organization loader (org-loader.ts)

Allowed:

- Using AWS SDK v3
- Querying Organizations API
- Returning normalized OU nodes

Not allowed:

- Writing planner logic here
- Modifying planner output logic in this layer

## 3. Budget config loader (budget-config-loader.ts)

Allowed:

- YAML parsing
- YAML comment round-tripping
- Validation
- Synchronization logic

Not allowed:

- Introducing side effects that would break determinism
- Moving org-structure-dependent logic into the config loader

## 4. CDK stack (budget-alerts-stack.ts)

Allowed:

- Mapping planner outputs to StackSets
- Adding CloudFormation resources
- Creating custom resources
- Wiring permissions
- Adding future IAM boundaries or service integrations

Not allowed:

- Planner logic
- Config merging logic
- Introducing account-specific assumptions
- Hard-coding organization IDs

---

# 🚢 Publishing a New Version

Only maintainers should publish to npm.

### 1. Build the package

```bash
npm run build
```

### 2. Test the tarball locally

```bash
npm pack
```

Install it in a fresh directory to validate the user experience:

```bash
npm install ../budget-alerts-<version>.tgz
npx budget-alerts-init-config
npx cdk synth
```

### 3. Publish

```bash
npm publish --access public
```

---

# 🗂 Branching Strategy

- `main` → always stable, publishable
- `dev` or feature branches → active development
- PRs must include tests when affecting planner or validation logic

---

# 🧾 Pull Request Requirements

Every PR must include:

- [ ] Clear description of the change
- [ ] Unit tests for new or changed planner behavior
- [ ] No breaking changes unless discussed
- [ ] No architectural violations
- [ ] Maintains npm package status
- [ ] Does not remove or bypass existing validation

---

# 🛑 Anti-Patterns (Do Not Do This)

- ❌ Adding AWS calls into planner logic
- ❌ Running unmocked AWS calls in unit tests
- ❌ Stubbing away planner logic to make tests pass
- ❌ Hard-coding Organization IDs or account numbers
- ❌ Adding features without documentation
- ❌ Rewriting module architecture without explicit approval

---

# 🧠 Design Principles Summary

- **Strong separation** of planner, config I/O, org discovery, and CDK stack
- **Predictability** and **determinism** in every planner function
- **Minimal customer boilerplate**
- **Pure functional planning logic**
- **Safe deployment via service-managed StackSets**
- **Config as the single source of truth**
