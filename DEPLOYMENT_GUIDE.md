# Remote GitHub and AKS Deployment Guide

This guide keeps the live application remote:

- GitHub is the remote source repository.
- GitHub Actions performs CI/CD on remote runners.
- Azure Container Registry stores the container image.
- Azure Kubernetes Service runs the application.
- GitHub Pages provides an HTTPS camera demo.

Your Mac may still contain a working copy of the files. That does not mean the
application is running locally. A local Git working copy is where you edit;
the remote repository is the copy stored on GitHub.

## Phase 1 - Create the GitHub repository

1. Sign in to GitHub.
2. Select **New repository**.
3. Name it `sit-to-stand-tracker`.
4. Choose **Public** so recruiters can view it.
5. Do not add a README, `.gitignore` or licence on the creation screen because
   this project already contains a README.
6. Select **Create repository**.

The expected remote URL is:

```text
https://github.com/valeriesxw/sit-to-stand-tracker.git
```

## Phase 2 - Push this project to the remote repository

In Terminal, enter the extracted project folder and check that you see
`index.html`, `Dockerfile`, `k8s` and `.github`:

```bash
cd ~/Documents/sit-to-stand-tracker
pwd
ls
```

Create the Git history and make the first commit:

```bash
git init -b main
git add .
git status
git commit -m "Build sit-to-stand Kubernetes portfolio project"
```

Connect it to the remote GitHub repository:

```bash
git remote add origin https://github.com/valeriesxw/sit-to-stand-tracker.git
git remote -v
git push -u origin main
```

If Terminal says `remote origin already exists`, change the existing address:

```bash
git remote set-url origin https://github.com/valeriesxw/sit-to-stand-tracker.git
git remote -v
git push -u origin main
```

GitHub does not accept an account password for Git operations. Use the browser
authentication prompt, Git Credential Manager, GitHub Desktop or a personal
access token when prompted.

### Checkpoint

Open the repository in GitHub. You should see the application files, the `k8s`
folder and the `.github/workflows/ci-cd.yml` file. Open **Actions** and confirm
that the `Validate and build container` job succeeds. The AKS deployment job
will be skipped until `AKS_ENABLED` is configured.

## Phase 3 - Turn on the HTTPS GitHub Pages demo

1. In the GitHub repository, select **Settings**.
2. Select **Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select branch `main` and folder `/ (root)`.
5. Select **Save**.

After deployment, the demo address will be:

```text
https://valeriesxw.github.io/sit-to-stand-tracker/
```

This remote HTTPS version should be used when demonstrating the camera feature.

## Phase 4 - Create Azure resources remotely

Open `portal.azure.com`, select the Cloud Shell icon and choose **Bash**. These
commands run in Azure Cloud Shell, not on your Mac.

Set project-specific variables. The ACR name must be globally unique, lowercase
and contain only letters and numbers. Change the digits if the name is taken.

```bash
AZURE_RG="rg-sit-to-stand"
AZURE_LOCATION="southeastasia"
AZURE_ACR="valeriesxwpose2026"
AZURE_AKS="aks-sit-to-stand"
AZURE_IDENTITY="github-sit-to-stand"
GITHUB_REPOSITORY="valeriesxw/sit-to-stand-tracker"
```

Confirm that you are using the intended Azure subscription:

```bash
az account show --output table
```

Create one resource group:

```bash
az group create \
  --name "$AZURE_RG" \
  --location "$AZURE_LOCATION"
```

Create a Basic ACR using regular registry-wide RBAC. This mode supports the
`--attach-acr` integration used below:

```bash
az acr create \
  --name "$AZURE_ACR" \
  --resource-group "$AZURE_RG" \
  --location "$AZURE_LOCATION" \
  --sku Basic \
  --role-assignment-mode rbac
```

Create a one-node AKS learning cluster and attach it to ACR:

```bash
az aks create \
  --name "$AZURE_AKS" \
  --resource-group "$AZURE_RG" \
  --location "$AZURE_LOCATION" \
  --node-count 1 \
  --node-vm-size Standard_B2s \
  --tier free \
  --generate-ssh-keys \
  --enable-managed-identity \
  --attach-acr "$AZURE_ACR"
```

If `Standard_B2s` is unavailable in your subscription or region, choose a
two-vCPU Linux size that Azure offers and rerun the AKS command with that size.

### Checkpoint

```bash
az acr show --name "$AZURE_ACR" --resource-group "$AZURE_RG" --output table
az aks show --name "$AZURE_AKS" --resource-group "$AZURE_RG" --output table
```

## Phase 5 - Give GitHub passwordless Azure access

Create a user-assigned managed identity for GitHub Actions:

```bash
az identity create \
  --name "$AZURE_IDENTITY" \
  --resource-group "$AZURE_RG" \
  --location "$AZURE_LOCATION"
```

Collect its IDs and the Azure resource IDs:

```bash
AZURE_CLIENT_ID="$(az identity show --name "$AZURE_IDENTITY" --resource-group "$AZURE_RG" --query clientId --output tsv)"
AZURE_PRINCIPAL_ID="$(az identity show --name "$AZURE_IDENTITY" --resource-group "$AZURE_RG" --query principalId --output tsv)"
AZURE_TENANT_ID="$(az account show --query tenantId --output tsv)"
AZURE_SUBSCRIPTION_ID="$(az account show --query id --output tsv)"
ACR_RESOURCE_ID="$(az acr show --name "$AZURE_ACR" --resource-group "$AZURE_RG" --query id --output tsv)"
AKS_RESOURCE_ID="$(az aks show --name "$AZURE_AKS" --resource-group "$AZURE_RG" --query id --output tsv)"
```

Allow the identity to push images to ACR and retrieve AKS administrator
credentials. These assignments are scoped only to the two project resources:

```bash
az role assignment create \
  --assignee-object-id "$AZURE_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role AcrPush \
  --scope "$ACR_RESOURCE_ID"

az role assignment create \
  --assignee-object-id "$AZURE_PRINCIPAL_ID" \
  --assignee-principal-type ServicePrincipal \
  --role "Azure Kubernetes Service Cluster Admin Role" \
  --scope "$AKS_RESOURCE_ID"
```

Create the OIDC trust relationship. GitHub can now request a short-lived token
only when the workflow is running from this repository's `main` branch:

```bash
az identity federated-credential create \
  --name github-main \
  --identity-name "$AZURE_IDENTITY" \
  --resource-group "$AZURE_RG" \
  --issuer "https://token.actions.githubusercontent.com" \
  --subject "repo:${GITHUB_REPOSITORY}:ref:refs/heads/main" \
  --audiences "api://AzureADTokenExchange"
```

Display the values needed for GitHub:

```bash
echo "AZURE_CLIENT_ID=$AZURE_CLIENT_ID"
echo "AZURE_TENANT_ID=$AZURE_TENANT_ID"
echo "AZURE_SUBSCRIPTION_ID=$AZURE_SUBSCRIPTION_ID"
echo "ACR_NAME=$AZURE_ACR"
echo "AZURE_RESOURCE_GROUP=$AZURE_RG"
echo "AKS_CLUSTER_NAME=$AZURE_AKS"
```

Do not share these values unnecessarily. OIDC avoids storing an Azure password,
but repository deployment settings should still be protected.

## Phase 6 - Configure GitHub Actions

In GitHub, open **Settings -> Secrets and variables -> Actions**.

Under **Secrets**, create:

| Secret | Value |
|---|---|
| `AZURE_CLIENT_ID` | The displayed client ID |
| `AZURE_TENANT_ID` | The displayed tenant ID |
| `AZURE_SUBSCRIPTION_ID` | The displayed subscription ID |

Under **Variables**, create:

| Variable | Value |
|---|---|
| `ACR_NAME` | Your globally unique ACR name |
| `AZURE_RESOURCE_GROUP` | `rg-sit-to-stand` |
| `AKS_CLUSTER_NAME` | `aks-sit-to-stand` |
| `AKS_ENABLED` | `true` |

## Phase 7 - Start the first AKS deployment

1. Open the repository's **Actions** tab.
2. Select **CI/CD to Azure Kubernetes Service**.
3. Select **Run workflow**.
4. Confirm branch `main` and run it.

The workflow should pass through these stages:

```text
Validate -> Build image -> Push to ACR -> Connect to AKS -> Deploy -> Rollout check
```

After it completes, open Azure Cloud Shell and retrieve the public IP:

```bash
az aks get-credentials \
  --name "$AZURE_AKS" \
  --resource-group "$AZURE_RG" \
  --admin \
  --overwrite-existing

kubectl get deployments,pods,services -n sit-to-stand
```

The Service may initially show `EXTERNAL-IP` as `<pending>`. Wait a few minutes
and run the final command again. Open `http://EXTERNAL-IP` to verify that AKS is
serving the page. Use the GitHub Pages HTTPS address when demonstrating the
camera until you add TLS to AKS.

## Phase 8 - Demonstrate continuous deployment

Change one visible sentence in `index.html`, then commit and push:

```bash
git add index.html
git commit -m "Update assessment instructions"
git push origin main
```

That single push now automatically starts the full CI/CD pipeline. The new
container receives a unique Git SHA tag, and Kubernetes performs a rolling
update across the two Pods.

## What to show in an interview

Show these items in order:

1. The working GitHub Pages camera demo.
2. The source repository and clear README.
3. A successful GitHub Actions run.
4. The versioned image in ACR.
5. The AKS Deployment with two healthy Pods.
6. The LoadBalancer Service and public IP.
7. A second commit causing an automatic rolling deployment.

Explain that camera inference is client-side for privacy and low latency, while
the remote platform serves immutable container versions through Kubernetes.

## Azure cost warning and cleanup

AKS worker nodes, the public LoadBalancer and ACR can incur charges even when
you are not actively demonstrating the project. Configure an Azure budget and
cost alert.

When you are completely finished and accept that all project Azure resources
will be deleted, remove the resource group from Azure Cloud Shell:

```bash
az group delete --name "$AZURE_RG" --yes --no-wait
```

This cleanup command is destructive. It deletes the AKS cluster, ACR and stored
container images. The GitHub repository and GitHub Pages site are not deleted.
