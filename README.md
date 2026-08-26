# Sit-to-Stand Lab

A browser-based 30-second chair-stand assessment that uses MediaPipe Pose
Landmarker to measure knee angle and count repetitions in real time. Camera
frames stay inside the visitor's browser and are not uploaded to the server.

## What this portfolio project demonstrates

- Browser computer vision with MediaPipe and JavaScript
- A non-root Nginx container image
- CI validation and container builds with GitHub Actions
- Versioned images stored in Azure Container Registry (ACR)
- Automated rolling deployments to Azure Kubernetes Service (AKS)
- Kubernetes health probes, resource limits, two replicas and a public Service
- Passwordless GitHub-to-Azure authentication using OpenID Connect (OIDC)

## Architecture

```text
Developer push
    -> GitHub repository
    -> GitHub Actions CI/CD
    -> Azure Container Registry
    -> AKS Deployment (2 Nginx Pods)
    -> Kubernetes LoadBalancer Service
```

The pose model runs on the user's device. AKS only serves the static HTML,
CSS and JavaScript files.

## Repository structure

```text
.
├── index.html
├── app.js
├── style.css
├── Dockerfile
├── nginx.conf
├── k8s/
│   ├── namespace.yaml
│   ├── deployment.yaml
│   └── service.yaml
└── .github/workflows/
    └── ci-cd.yml
```

## CI/CD flow

1. A pull request or push triggers GitHub Actions.
2. CI checks the application files and JavaScript syntax.
3. CI builds the Docker image on a remote GitHub-hosted runner.
4. For `main`, CD authenticates to Azure using OIDC.
5. The image is tagged with the Git commit SHA and pushed to ACR.
6. GitHub Actions deploys that exact version to AKS.
7. Kubernetes performs a rolling update and checks Pod health.

## Functional public demo

Camera access requires HTTPS. GitHub Pages supplies HTTPS automatically and is
the simplest place for the fully functional portfolio demo. In the repository,
open **Settings -> Pages**, select **Deploy from a branch**, then choose
`main` and `/ (root)`.

The AKS LoadBalancer initially provides an HTTP public IP. It proves that the
container and Kubernetes deployment work, but browsers can block camera access
on that URL. To make the AKS copy fully functional, add a domain, an Ingress
controller and a trusted TLS certificate.

## Deployment instructions

Follow [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md). The guide uses Azure Cloud
Shell, so Azure infrastructure and deployment do not run on your Mac.

## Assessment logic

- Knee angle below `110` degrees: sitting state
- Knee angle above `160` degrees after sitting: one repetition
- Test duration: 30 seconds
- Hold either hand above the head for two seconds: reset

## Privacy and limitations

Pose inference runs inside the browser. The application does not upload or
record camera frames. This is a learning and casual fitness project, not a
medical device or clinical assessment tool.
