Bus Ticketing & Payment System

A production-shaped bus ticketing platform built to demonstrate a full, real-world
DevOps pipeline: containerization, infrastructure as code, container orchestration,
CI/CD automation, and observability — all running on AWS.

Built as part of the Pinnacle Labs 2026 Internship Program (Cloud Computing track —
"Host a Dynamic Website" task, extended into a complete DevOps pipeline).

## Live links

- **Live app:** http://a23ad99c7e6374b2e8979c8a96b2d0c5-1548492304.us-east-1.elb.amazonaws.com
- **Grafana dashboard:** http://a06abe7fd775a47bc926bf926fe19152-1716064411.us-east-1.elb.amazonaws.com
- **GitHub Actions pipeline:** https://github.com/victor0693/bus-ticketing-aws-devops/actions

## Architecture overview

```
Developer pushes code to GitHub (main branch)
        │
        ▼
GitHub Actions (CI/CD)
  1. Builds a Docker image from the app
  2. Pushes it to Amazon ECR (private image registry)
  3. Deploys the new image to Amazon EKS (rolling update)
        │
        ▼
Amazon EKS (Kubernetes cluster, provisioned via Terraform)
  ├── bus-ticketing-app  (Node.js/Express, 1 replica)
  ├── postgres           (database, internal only)
  ├── prometheus-server  (metrics collection)
  └── grafana            (dashboards)
        │
        ▼
Public internet, via AWS Load Balancers (one for the app, one for Grafana)
```

## Tech stack

| Layer | Tool | Purpose |
|---|---|---|
| Application | Node.js + Express | Handles routing, seat booking logic |
| Database | PostgreSQL | Stores bus routes and bookings |
| Payments | Stripe (test mode) | Real hosted checkout flow, no live charges |
| Containerization | Docker | Packages the app identically for local + cloud |
| Infrastructure as Code | Terraform | Provisions VPC, EKS cluster, ECR repository |
| Orchestration | Amazon EKS (Kubernetes) | Runs, monitors, and self-heals the app |
| CI/CD | GitHub Actions | Automated build → push → deploy on every push to `main` |
| Monitoring | Prometheus + Grafana | Live metrics and dashboards |

## Why this architecture

- **Scalability & reliability**: Kubernetes runs the app as a Deployment, which
  means AWS can add more replicas under load, and any crashed pod is
  automatically restarted without manual intervention.
- **Security**: No AWS credentials or Stripe keys are stored in code or in the
  Git repository. Local development uses a gitignored `.env` file; the running
  cluster uses a Kubernetes Secret; the CI/CD pipeline uses encrypted GitHub
  Actions secrets. A dedicated, least-privilege IAM user (`github-actions-deployer`)
  is used for automated deployments, separate from the personal admin account
  used for manual setup.
- **Rollback safety**: The app is deployed as a Kubernetes Deployment with
  readiness and liveness probes tied to a `/health` endpoint. Kubernetes will
  not route traffic to a new version until it passes its health check, and any
  release can be reverted instantly with `kubectl rollout undo`.
- **Automation**: Every code change pushed to `main` is automatically built,
  containerized, pushed to a private registry, and deployed — no manual steps.
- **Observability**: Prometheus continuously scrapes metrics from the running
  cluster; Grafana visualizes them, making the system's health inspectable at
  a glance rather than something inferred from logs alone.

## Known trade-offs (and why)

Built and deployed under real AWS account constraints (free-tier instance size
restrictions), the following deliberate trade-offs were made — the kind of
constraint-driven decisions that come up constantly in real infrastructure work:

- **1 app replica instead of 2**: the account's smallest available instance
  type (`t3.micro`) has a limited pod-per-node capacity. Running 2 replicas
  alongside Postgres, Prometheus, and Grafana exceeded that limit. In a
  production environment with larger or more numerous nodes, this would be
  increased for true zero-downtime redundancy.
- **Ephemeral (non-persistent) storage for Postgres, Prometheus, and Grafana**:
  data resets if a pod restarts. A production setup would provision the AWS
  EBS CSI driver and use PersistentVolumeClaims backed by real EBS volumes.
- **Minimal monitoring stack**: Alertmanager, node-exporter, kube-state-metrics,
  and Pushgateway were disabled to fit available cluster capacity. Core metrics
  collection (Prometheus) and visualization (Grafana) remain fully functional.
- **HTTP, not HTTPS, on the app's public URL**: no custom domain/ACM certificate
  was attached to this project's load balancer. The static site project in this
  same internship demonstrates the full HTTPS setup via ACM + CloudFront.

## Local development

```bash
git clone https://github.com/[yourusername]/bus-ticketing-aws-devops.git
cd bus-ticketing-aws-devops
cp .env.example .env   # then add your own Stripe test secret key
docker compose up --build
```
Visit `http://localhost:3000`. Use Stripe test card `4242 4242 4242 4242`,
any future expiry date, any 3-digit CVC.

## Infrastructure

Terraform configuration lives in `infra/`:
```bash
cd infra
terraform init
terraform plan
terraform apply
```
Provisions: a VPC with public/private subnets across two availability zones,
an EKS cluster, a managed node group, and an ECR repository.

## Kubernetes manifests

Located in `k8s/`:
- `postgres.yaml` — database Deployment + internal Service
- `app-deployment.yaml` — application Deployment + public LoadBalancer Service

Monitoring (Prometheus + Grafana) is installed via Helm rather than raw
manifests — see deployment notes below.

```bash
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/app-deployment.yaml

helm install prometheus prometheus-community/prometheus \
  --set alertmanager.enabled=false \
  --set prometheus-node-exporter.enabled=false \
  --set kube-state-metrics.enabled=false \
  --set pushgateway.enabled=false \
  --set server.persistentVolume.enabled=false

helm install grafana grafana/grafana \
  --set persistence.enabled=false \
  --set service.type=LoadBalancer
```

## CI/CD pipeline

Defined in `.github/workflows/deploy.yml`. On every push to `main`:
1. Checks out the latest code
2. Authenticates to AWS using a dedicated, least-privilege IAM identity
3. Builds and pushes a new Docker image to ECR
4. Updates the running Kubernetes Deployment to use the new image
5. Waits for the rollout to complete successfully before finishing

## Project status

- [x] App built and working locally with Docker Compose
- [x] Terraform infrastructure (VPC, EKS, ECR)
- [x] Deployed to EKS
- [x] CI/CD pipeline via GitHub Actions
- [x] Prometheus + Grafana monitoring
