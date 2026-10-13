# Profile, edit profile and avatar

Contract for the web and mobile clients. All routes are under the `/api` prefix, need a signed-in user
(web session cookie + `X-Farm2Fork-CSRF` header, or the mobile bearer token) and work for every role.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/auth/me` | Unchanged, plus `fullName` and `avatarUrl` on the user. |
| `GET` | `/auth/me/profile` | The user, a `displayName`, and the role details (`profile`). |
| `PATCH` | `/auth/me/profile` | Edit. Send only the fields that changed. Returns the same shape as `GET`. |
| `PUT` | `/auth/me/avatar` | Multipart field `file` (JPEG, PNG or WebP, max 5 MB). Returns the profile. |
| `DELETE` | `/auth/me/avatar` | Remove the photo. Returns the profile. |
| `PATCH` | `/farmers/me/farm-location` | Unchanged. The farm pickup location keeps its own endpoint. |

### `GET /auth/me/profile`

```jsonc
{
  "user": { "id": "...", "email": "a@b.com", "role": "buyer", "phone": "+923001234567",
            "fullName": "Ayesha Khan", "avatarUrl": "https://res.cloudinary.com/<cloud>/image/upload/c_fill,g_auto,w_256,h_256,f_auto,q_auto/v1700/farm2fork/avatars/<id>",
            "isVerified": true, "isActive": true },
  "displayName": "Ayesha Khan",   // fullName, else business / farm / institution name, else the email name
  "profile": {
    "kind": "buyer",              // buyer | farmer | transporter | financial_partner | admin
    "cnicMasked": "*********5671",  // read only, never the full number
    // buyer:       businessName, businessType (individual|retailer|restaurant|wholesaler)
    // farmer:      farmName, cropTypes[], landSizeAcres, farmLocation { address, city, province, lat, lng, complete }
    // transporter: vehicleType (bike|rickshaw|van|truck), vehicleNumber, serviceAreas[]
    // financial_partner: institutionName, institutionType
  }
}
```

### `PATCH /auth/me/profile`

Common to every role: `fullName` (2-80), `phone` (E.164, for example `+923001234567`; the client normalises `0300 1234567`).
Buyer: `businessName` (2-120), `businessType`. Farmer: `farmName`, `cropTypes` (max 20), `landSizeAcres` (0-100000).
Transporter: `vehicleType`, `vehicleNumber` (3-20), `serviceAreas` (max 20).

- `400` with a message for a bad value, for a field that belongs to another role (`farmName cannot be edited for the buyer role`),
  for `email` / `cnic` (identity data is not editable), or for an empty body.
- Edits are audited by field name only, never by value.

## Avatar and Cloudinary

- Set `CLOUDINARY_URL=cloudinary://<api_key>:<api_secret>@<cloud_name>` (Cloudinary console, API Keys). Without it
  uploads fall back to local disk in development and `avatarUrl` is a root-relative `/api/files/public/...` path.
- The client **crops to a square before uploading** and sends that file. A 512 px JPEG at quality ~0.85 is plenty (about 40 KB).
- The server validates the file by content, uploads it through the Cloudinary Node SDK to the fixed public id
  `farm2fork/avatars/<userId>` (`overwrite` + `invalidate`, so one avatar per user and no stale CDN copy), and keeps
  at most 1024 px.
- **MongoDB stores only the delivery path** (`users.avatarPath` = `v<version>/farm2fork/avatars/<userId>`), never a URL.
  The API builds `avatarUrl` from it with Cloudinary URL transformations (`c_fill,g_auto,w_256,h_256,f_auto,q_auto`).
- For another size, replace `w_256,h_256` in `avatarUrl` (for example `w_96,h_96`, or 2x for dense screens). Do not build
  Cloudinary URLs from anything else, and never ship the API secret to a client.
- The upload route is rate limited (10 per minute per IP).
