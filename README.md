# FST Records API

Express/MongoDB backend for faculty records, marks, attendance, Excel export, PDF storage, and administrative reporting.

## Local development

Requirements: Node.js 22 or newer and MongoDB.

```powershell
Copy-Item .env.example .env
npm ci
npm test
npm start
```

Generate secrets instead of copying examples:

```bash
openssl rand -hex 32
openssl rand -base64 24
```

`CLIENT_ORIGINS` is a comma-separated list of exact origins without paths, such as `http://localhost:5173,https://fst-client.vercel.app`.

## Production architecture

- MongoDB Atlas M0 stores application data.
- A $12/month Lightsail Ubuntu instance runs Node.js 22 under `systemd`.
- Caddy provides HTTPS using `<static-ip-with-dashes>.sslip.io` and proxies to `127.0.0.1:5000`.
- Vercel hosts the separate `fst_client` repository.
- Uploaded PDFs remain on the Lightsail disk at `/var/lib/fst-api/uploads`; Lightsail snapshots are required for backup.

The $12 plan is the default. Move to $24 only after `free -h`, `top`, or Lightsail metrics show sustained memory/CPU pressure.

## 1. Create MongoDB Atlas M0

1. In Atlas, create a project and an M0 free cluster in the AWS region nearest the Lightsail instance.
2. Create a database user with a generated password. Save it in a password manager.
3. Create the Lightsail instance and attach a static IPv4 address before setting Atlas network access.
4. In Atlas **Network Access**, allow only `<LIGHTSAIL_STATIC_IP>/32`. Do not leave `0.0.0.0/0` enabled.
5. Copy the Node.js connection string, set the database name to `fst_records`, URL-encode special password characters, and store the result only in `/etc/fst-api.env`.

## 2. Create the Lightsail instance

In AWS Lightsail:

1. Create an **OS Only / Ubuntu 24.04 LTS** instance in the chosen region.
2. Select the **$12 USD/month** Linux plan.
3. Name it `fst-api`, create it, then attach a static IPv4 address.
4. Under Networking, allow TCP 22 from your own public IP when possible, TCP 80 from anywhere, and TCP 443 from anywhere. Do not open port 5000.
5. Connect through the Lightsail browser SSH terminal and run:

```bash
sudo apt-get update
sudo apt-get install -y git
git clone https://github.com/NIMITHASHREE/fst_server_records_Application.git
cd fst_server_records_Application
sudo bash deploy/install-lightsail.sh
```

## 3. Configure API secrets

Create the root-owned service environment:

```bash
sudo install -m 0600 /dev/null /etc/fst-api.env
sudo nano /etc/fst-api.env
```

Enter real values using this shape:

```dotenv
NODE_ENV=production
PORT=5000
MONGO_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/fst_records?retryWrites=true&w=majority
JWT_SECRET=PASTE_OUTPUT_FROM_OPENSSL_RAND_HEX_32
ADMIN_USERNAME=CHOOSE_A_NON_DEFAULT_ADMIN_NAME
ADMIN_PASSWORD=PASTE_OUTPUT_FROM_OPENSSL_RAND_BASE64_24
CLIENT_ORIGINS=https://YOUR_VERCEL_PROJECT.vercel.app
UPLOAD_DIR=/var/lib/fst-api/uploads
```

Do not paste these values into GitHub, Vercel, chat, screenshots, or shell history.

## 4. Configure free HTTPS

Convert the static IP to dashes. For example, `203.0.113.10` becomes `203-0-113-10.sslip.io`.

```bash
sudo nano /etc/caddy/Caddyfile
```

```caddyfile
203-0-113-10.sslip.io {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5000
}
```

Then start and verify:

```bash
sudo systemctl enable --now fst-api caddy
sudo systemctl status fst-api --no-pager
sudo systemctl status caddy --no-pager
curl https://203-0-113-10.sslip.io/
```

The expected health response is `{"message":"FST Project API is running"}`.

## 5. Deploy the client to Vercel

Import `NIMITHASHREE/fst_client`, set `VITE_API_URL` to `https://<static-ip-with-dashes>.sslip.io/api`, and deploy. If Vercel assigns a different production hostname than the one in `CLIENT_ORIGINS`, update `/etc/fst-api.env` and restart:

```bash
sudo systemctl restart fst-api
```

## Updates and rollback

Before each update, take a Lightsail manual snapshot. Then:

```bash
sudo -u fst-api git -C /opt/fst-api fetch origin
sudo -u fst-api git -C /opt/fst-api switch main
sudo -u fst-api git -C /opt/fst-api pull --ff-only origin main
sudo -u fst-api npm --prefix /opt/fst-api ci --omit=dev
sudo systemctl restart fst-api
curl https://<static-ip-with-dashes>.sslip.io/
```

To roll back application code, switch `/opt/fst-api` to a known commit, run `npm ci --omit=dev`, and restart. Restore the Lightsail snapshot if files or the instance are damaged.

## Monitoring and backup

```bash
sudo journalctl -u fst-api -n 200 --no-pager
sudo journalctl -u caddy -n 200 --no-pager
free -h
df -h
```

Enable automatic Lightsail snapshots or take scheduled manual snapshots. Atlas M0 has limited backup features, so periodically export important data with `mongodump` to protected storage. Test restoration before relying on a backup.

## Known dependency note

`npm audit` reports a moderate advisory in the `uuid` version bundled by ExcelJS 4.4.0. The automated npm recommendation is a breaking downgrade to ExcelJS 3.4.0. The affected UUID buffer APIs are not used by this application, and all high/critical production advisories have been removed; reassess when ExcelJS publishes a compatible update.
