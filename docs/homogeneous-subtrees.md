# Homogeneous Budget Subtrees – Visual Guide

This guide explains how **homogeneous budget subtrees** work in the context of the budget-alerts solution.

A *homogeneous subtree* is a section of your OU hierarchy where every OU and every account (in leaf OUs) has the **same effective budget**.

Important assumptions:

- Only **leaf OUs** are expected to contain accounts (except for the management/root account).
- Intermediate OUs (like `Environments` or `Applications`) are used purely for structure and do not receive budgets directly.

---

## Example 1 – Fully Homogeneous Subtree

```text
Root
└── Prod (amount: 50)
    ├── TeamA  (inherits 50)
    └── TeamB  (inherits 50)
````

All OUs in the `Prod` subtree share the same budget: `50`.

Result:

* `Prod` is treated as **one homogeneous subtree**.
* A single StackSet is created targeting the `Prod` OU.
* All accounts in `TeamA` and `TeamB` receive `budget(50)` through that StackSet.

---

## Example 2 – Different Budgets for Sibling Environments

```text
Root
└── Environments
    ├── Dev  (amount: 10)
    └── Prod (amount: 50)
```

Here, `Dev` and `Prod` have different budgets.

There are no accounts in `Root` or `Environments`; only `Dev` and `Prod` are leaf OUs with accounts.

Result:

* `Dev` is a homogeneous subtree with `budget(10)`.
* `Prod` is a homogeneous subtree with `budget(50)`.
* Two StackSets are created:

  * one targeting the `Dev` OU,
  * one targeting the `Prod` OU.

This layout is **perfectly valid**.

---

## Example 3 – One Overridden Child, One Inheriting Child

```text
Root (default: 10)
└── Applications (inherits 10)
    ├── Payroll    (amount: 20)
    └── Accounting (inherits 10)
```

There are no accounts in `Applications`, only in the leaf OUs:

* `Payroll` overrides the budget to `20`.
* `Accounting` keeps the default `10`.

Result:

* `Payroll` is a homogeneous subtree with `budget(20)`.
* `Accounting` is a homogeneous subtree with `budget(10)`.
* Two StackSets are created:

  * one targeting `Payroll`,
  * one targeting `Accounting`.

The parent `Applications` OU is **purely structural**; it does not receive a StackSet.
This layout is also **valid**.

---

## Example 4 – Problematic Case: Accounts in a Non-Leaf OU

```text
Root (default: 10)
└── Finance (inherits 10, contains accounts)
    ├── Payroll    (amount: 20)
    └── Accounting (inherits 10, contains accounts)
```

The issue here is not the difference between `Payroll` (20) and `Accounting` (10) budgets — that pattern is similar to Example 3 and is fine **if only the leaf OUs contain accounts**.

The problem is:

* `Finance` itself contains accounts (with `budget(10)`),
* `Accounting` also contains accounts (with `budget(10)`),
* `Payroll` has accounts with `budget(20)`,

…all within the same subtree, which makes it hard to represent cleanly using OU-level StackSets.

The model assumes:

* Only **leaf OUs** contain accounts.
* Each leaf OU subtree should be homogeneous.

To fix this, you can separate the common and special-case accounts into different OUs:

```text
Root
├── Finance-Common (10)
└── Payroll        (20)
```

Now:

* `Finance-Common` is a homogeneous subtree for all accounts that should have `budget(10)`.
* `Payroll` is a homogeneous subtree for accounts that should have `budget(20)`.

Two StackSets are created:

* one for `Finance-Common` (10),
* one for `Payroll` (20).

---

## Summary

* Different budgets for **sibling leaf OUs** (e.g., `Dev` vs `Prod`, or `Payroll` vs `Accounting`) are fine.
* Structural parent OUs like `Environments` or `Applications` typically do **not** receive budgets.
* Key constraints:

  * Only **leaf OUs** should contain accounts (except the root/management account).
  * Each leaf OU subtree should be **homogeneous** with respect to its effective budget:

    * one subtree → one budget → one StackSet.
