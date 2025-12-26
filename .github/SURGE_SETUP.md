# GitHub Actions Deployment Setup

This repository is configured to automatically deploy to Surge.

## Security Model

Our CI/CD pipeline uses a **two-stage workflow_run pattern** that safely handles untrusted PR code:

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: Build Workflow (build.yml)                             │
│ - Triggers on: push to main, pull_request                       │
│ - Permissions: contents: read (NO secrets access for fork PRs)  │
│ - Runs: npm ci, build, test                                     │
│ - Output: Static artifacts (dist/)                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ workflow_run trigger
┌─────────────────────────────────────────────────────────────────┐
│ Stage 2: Deploy Workflow (deploy-surge.yml)                     │
│ - Triggers on: workflow_run completed                           │
│ - Permissions: HAS secrets access                               │
│ - Runs: Download artifact → Deploy static files                 │
│ - Key: Never executes PR code, only deploys pre-built artifacts │
└─────────────────────────────────────────────────────────────────┘
```

### Why This Is Secure

1. **Untrusted code runs without secrets**: Fork PR code executes in Stage 1, which has no access to `SURGE_TOKEN`.

2. **Secrets never touch PR code**: Stage 2 has secrets but only downloads and deploys static files—it never checks out or executes the PR's code.

3. **Artifact isolation**: Artifacts are downloaded from the specific workflow run ID, preventing artifact confusion attacks.

4. **SHA-pinned actions**: All GitHub Actions are pinned to specific commit SHAs, preventing supply chain attacks via compromised action tags.

### What Could Go Wrong (and Mitigations)

| Threat | Mitigation |
|--------|------------|
| Malicious PR deploys bad frontend code | Only to PR preview URL, not production. Production only deploys from main. |
| Compromised GitHub Action | SHA pinning—won't auto-update to malicious version |
| Stolen secrets | Secrets in GitHub Secrets, never in code. Rotate periodically. |
| Artifact tampering | Downloaded from specific `run-id`, not by name lookup |

### Updating Pinned Actions

When updating pinned actions, get the new SHA:
```bash
gh api repos/OWNER/REPO/commits/vX --jq '.sha'
```

Then update the workflow file:
```yaml
uses: actions/checkout@NEW_SHA_HERE # vX
```

### Rotating Secrets

To rotate the Surge token (scoped to `surge-deploy` environment):
```bash
surge token | gh secret set SURGE_TOKEN --repo idvorkin/swing-analyzer --env surge-deploy
```

## Setup Instructions

### 1. Get Your Surge Token

First, login to Surge locally (one-time setup):

```bash
npm install -g surge
surge login
```

Then get your token:

```bash
surge token
```

This will output something like: `abc123def456...`

### 2. Create GitHub Environment

1. Go to your GitHub repository
2. Navigate to **Settings** → **Environments**
3. Click **New environment**
4. Name it `surge-deploy`

### 3. Add GitHub Secrets

In the `surge-deploy` environment, add these secrets:

#### Secret 1: SURGE_TOKEN

- **Name**: `SURGE_TOKEN`
- **Value**: Your token from `surge token` command

#### Secret 2: SURGE_DOMAIN

- **Name**: `SURGE_DOMAIN`
- **Value**: `swing-analyzer.surge.sh`

### 4. Push to GitHub

Once secrets are configured, any push to `main` will trigger:

1. Build and test
2. Deploy to Surge

### 5. Verify Deployment

After pushing, check:

- **GitHub Actions**: See the workflow run in the Actions tab
- **Live Site**: Visit https://swing-analyzer.surge.sh

## Workflow Details

The workflow runs on:

- Every push to `main` branch → deploys to production
- Pull requests to `main` → deploys to `pr-N-swing-analyzer.surge.sh`

### Manual Deployment

You can still deploy manually:

```bash
just deploy
```

## Troubleshooting

### Build Fails

- Check the GitHub Actions logs
- Ensure all dependencies are in `package.json`
- Test the build locally: `just test`

### Deployment Fails

- Verify `SURGE_TOKEN` is valid: `surge token`
- Check `SURGE_DOMAIN` format (no `https://` prefix)
- Ensure secrets are properly set in GitHub environment

### Site Not Updating

- Clear browser cache
- Check GitHub Actions for successful deployment
- Verify the correct branch was pushed
