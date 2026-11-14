# Lost Property Office

An accessible records-management web app for a campus lost property desk.
Staff log found items and lost-item enquiries, search and sort the records, and record when an item goes back to its owner.

Accessibility and Usability, Coursework 2.

**Live site:** https://YOUR-DOMAIN-HERE  ← replace with your real domain

## What's in the folder

```
lostfound/
├── server.js            Node.js backend: serves the site and the JSON API
├── package.json
├── data/records.json    The database (created automatically on first run, with sample records)
└── public/
    ├── index.html       All five screens (sign in, home, log an item, records, record detail)
    ├── css/main.css
    ├── js/app.js
    └── favicon.svg
```

No npm packages are needed. Node.js 18 or newer is enough.

## Run it on your own computer

```
cd lostfound
node server.js
```

Then open http://localhost:3000.
Sign in with any staff name and a password of 4 or more characters. Choose **Supervisor** to see the "Disposed" option.

To start again with the sample data, stop the server and delete `data/records.json`.

## API

| Method | Path | What it does |
|---|---|---|
| GET | `/api/records` | List all records |
| GET | `/api/records/:id` | One record |
| POST | `/api/records` | Create a record (validated on the server too) |
| PATCH | `/api/records/:id` | Change status: `Open`, `Returned` (needs `returnedTo` and `idChecked: true`) or `Disposed` (Supervisor only) |

## Deploy (DigitalOcean droplet + Namecheap domain)

1. **Create a droplet.** DigitalOcean > Create > Droplets > Ubuntu 24.04, the smallest plan. Copy its IP address.
2. **Install software.** Connect with `ssh root@YOUR_IP` and run:
   ```
   apt update && apt install -y nodejs npm nginx certbot python3-certbot-nginx
   npm install -g pm2
   ```
3. **Upload the app.** From your own computer:
   ```
   scp -r lostfound root@YOUR_IP:/var/www/
   ```
4. **Keep it running.** On the droplet:
   ```
   cd /var/www/lostfound
   pm2 start server.js --name lostfound
   pm2 save && pm2 startup
   ```
5. **Point the domain at the droplet.** Namecheap > Domain List > Manage > Advanced DNS. Add an A record with host `@` and value YOUR_IP, and another with host `www` and the same value.
6. **Set up Nginx as a reverse proxy.** Create `/etc/nginx/sites-available/lostfound` containing:
   ```
   server {
       listen 80;
       server_name yourdomain.com www.yourdomain.com;
       location / {
           proxy_pass http://localhost:3000;
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
       }
   }
   ```
   Then run:
   ```
   ln -s /etc/nginx/sites-available/lostfound /etc/nginx/sites-enabled/
   rm -f /etc/nginx/sites-enabled/default
   nginx -t && systemctl reload nginx
   ```
7. **Add HTTPS** once the domain loads over http (DNS can take up to an hour):
   ```
   certbot --nginx -d yourdomain.com -d www.yourdomain.com
   ```
8. **Firewall (optional but sensible):**
   ```
   ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
   ```

Records are saved in `/var/www/lostfound/data/records.json`, so they survive refreshes, browser restarts and server restarts.
