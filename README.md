# 📦 Budget Alerts for AWS Organizations

[![Tests](https://github.com/superluminar-io/budget-alerts/actions/workflows/lint-and-test.yml/badge.svg?branch=main)](https://github.com/superluminar-io/budget-alerts/actions/workflows/lint-and-test.yml)

Automatically deploy budget alerts across your AWS Organization using **service-managed CloudFormation StackSets**, with a simple and declarative YAML configuration.

This tool lets you:

* Define **default budgets** for the entire organization
* Override budgets for specific Organizational Units
* Automatically compute **minimal homogeneous subtrees**
* Deploy budgets into **all accounts** in the target OUs
* Keep your config in sync with your AWS Organization structure
* Deploy safely and consistently using a single CDK stack

Perfect for organizations needing consistent, automated cost-governance across accounts.

---

# 🔐 Requirements & Prerequisites

Before you begin, ensure the following prerequisites are met.

## 1. Deploy from a CloudFormation **StackSets Delegated Administrator**

You must run:

```bash
npx cdk synth
npx cdk deploy
```

from either:

* the **management account** *(root of the AWS Organization)*, or
* an account explicitly registered as a **CloudFormation StackSets Delegated Administrator**.

### Register a delegated admin (management account only)

```bash
aws cloudformation register-delegated-administrator \
  --account-id <TARGET_ACCOUNT_ID> \
  --service-principal cloudformation.amazonaws.com
```

Verify:

```bash
aws organizations list-delegated-administrators \
  --service-principal cloudformation.amazonaws.com
```

---

## 2. StackSets must use **service-managed** permissions

This solution deploys AWS Budgets via **service-managed StackSets** targeting OUs.

Required:

* **Trusted access** enabled for CloudFormation
* Delegated administrator set for service-managed StackSets
* CloudFormation-created StackSet roles:

  * `AWSCloudFormationStackSetAdministrationRole`
  * `AWSCloudFormationStackSetExecutionRole`

Enable trusted access:

```bash
aws organizations enable-aws-service-access \
  --service-principal cloudformation.amazonaws.com
```

---

## 3. IAM permissions for deployment

The deploying IAM principal requires:

### Organizations (read-only)

* `organizations:DescribeOrganization`
* `organizations:ListRoots`
* `organizations:ListOrganizationalUnitsForParent`
* `organizations:ListAccountsForParent`
* `organizations:ListAccounts`

### CloudFormation StackSets

* `cloudformation:*`
  (or Administrative privileges in the delegated admin account)

### Budgets API

* `budgets:*`

---

## 4. Valid AWS CLI/CDK credentials

Deployment requires valid AWS CLI or AWS SSO credentials on the machine running CDK.

---

## 5. Must be part of the **same AWS Organization**

The package discovers your organization, computes OU budgets, and deploys OU-targeted StackSets. It **cannot** run outside an AWS Organization.

---

## 6. OU & budget layout must allow **homogeneous subtrees**

This solution computes **homogeneous subtrees** to minimize the number of StackSets. For this to be possible, your OU layout and budget model must satisfy:

* With the exception of the **management account**, every account should either:

  * live in a **leaf OU**, **or**
  * share the **same effective budget** as the OU it resides in and all of that OU’s descendants.
* In other words, within any OU that contains accounts and/or child OUs, the **effective budget must be identical across that entire subtree** if you expect it to be treated as one homogeneous region.

If accounts in the same OU subtree are intended to have **different budgets**, this tool cannot represent that intent with OU-level StackSets and homogeneous subtrees. In that case, you should:

* Move accounts into separate leaf OUs that reflect their budget, or
* Adjust your budget model so that all accounts in a given OU subtree share the same effective budget.

We know it's a trade-off, but this constraint allows us to deliver a simple,
predictable, and fully automated solution that works well for the vast majority
of use cases. Using service managed stacksets at the OU level is a powerful way
to achieve organization-wide budget governance with minimal overhead and the
advantage of new accounts automatically inheriting the correct budgets.

---

# 🚀 Quick Start

## 1. Create an empty project

```bash
mkdir my-budgets
cd my-budgets
npm init -y
```

## 2. Install required packages

```bash
npm install --save-dev budget-alerts aws-cdk-lib constructs cdk-stacksets
```

These provide:

* `budget-alerts` → this package
* `aws-cdk-lib` + `constructs` → CDK core
* `cdk-stacksets` → constructs required by BudgetAlertsStack

---

# 🧩 Initialize configuration

Run:

```bash
npx budget-alerts-init-config
```

This generates:

```
budget-config.yaml
cdk.json
```

`cdk.json` is automatically configured to run the packaged CDK app:

```json
{
  "app": "npx budget-alerts",
  "context": {
    "budgetConfigPath": "budget-config.yaml"
  }
}
```

---

# ✏️ Edit `budget-config.yaml`

Example:

```yaml
default:
  amount: 10
  currency: EUR

organizationalUnits:
  ou-1234abcd:
    amount: 25
  ou-5678efgh:
    amount: 50
```

Notes:

* `default.amount` is required
* OU entries override the default
* Unknown OU IDs are rejected
* OU metadata (name, parent) is stored as comments for readability

---

# 🔄 Keep the config in sync

Your organization evolves. Refresh your config at any time:

```bash
npx budget-alerts-init-config
```

Optional prune:

```bash
npx budget-alerts-init-config --prune
```

* Adds missing OUs
* Removes OUs no longer in the org
* Preserves budget values
* Updates YAML comments

---

# ⚙️ Bootstrap (first time only)

Required for CDK deployments:

```bash
npx cdk bootstrap
```

This prepares your delegated admin account for CDK.

---

# 🚢 Deploy budgets

```bash
npx cdk deploy
```

What happens:

1. CDK runs `npx budget-alerts` as configured in `cdk.json`
2. The tool:

   * Discovers the entire AWS Organization structure
   * Loads and validates `budget-config.yaml`
   * Resolves your Organization ID dynamically
   * Computes effective budgets per OU
   * Computes homogeneous subtrees
   * Determines StackSet attachment points per OU
3. CDK deploys:

   * One StackSet per OU where budgets need to be applied
   * Each StackSet deploys AWS Budgets to all accounts in that OU

The result: **fully automated, consistent budgets across your AWS Organization.**

---

# 🔍 Dry-run without deploying

```bash
npx cdk synth
```

This performs:

* Org discovery
* Config validation
* Budget planning
* StackSet synthesis

But does **not** deploy anything.

---

# 🧼 Cleanup

Removing the deployment:

```bash
npx cdk destroy
```

This tears down:

* StackSets
* StackSet instances in every account
* All AWS Budgets created by this solution

---

# 🤝 Support

This solution is maintained by **superluminar GmbH**.

If you need help integrating budget governance, automation, or AWS Organizations tooling into your enterprise setup, feel free to reach out.
