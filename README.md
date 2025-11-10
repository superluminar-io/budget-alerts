# Budget Alerts

Budget Alerts is a Cloud Development Kit (CDK)-based project that helps you set
up automated AWS Budget Alerts for cost monitoring across all organizational units
within AWS Organizations. This project utilizes AWS Lambda, AWS Budgets, and
AWS Organizations services to create a seamless way of monitoring and alerting
on costs.

Budgets are rolled out to all accounts under the AWS Organization using the
CloudFormation self managed stack sets.

## Features
- Automatically generates AWS Budget Alerts.
- Sends notifications via email when thresholds are exceeded.
- Supports accounts under AWS Organizations.
- Creates resources and permissions safely using CDK.

## Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/superluminar-io/budget-alerts.git
   cd budget-alerts
   ```
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage
- To deploy the CDK stack to your AWS account:
  ```bash
  npx cdk deploy
  ```
- Compare deployed stack with the current state:
  ```bash
  npx cdk diff
  ```
- Synthesize the CloudFormation template:
  ```bash
  npx cdk synth
  ```
