# Souki (سوقي) — site web

Petites annonces pour la Mauritanie. Hébergement gratuit sur **Cloudflare Workers** avec une base de données **Cloudflare D1**.

## Contenu

| Dossier / fichier | Rôle |
|---|---|
| `public/index.html` | Le site (français / arabe) |
| `src/api.js` | Le serveur : comptes, annonces, photos, favoris, messages |
| `src/worker.js` | Point d'entrée Cloudflare (envoie `/api/...` au serveur, le reste au site) |
| `wrangler.jsonc` | Réglages Cloudflare, dont l'**ID de la base D1** à coller |
| `schema.sql` | Structure de la base (créée automatiquement au premier lancement) |

## Mise en ligne sur Cloudflare Workers (une seule fois)

1. Cloudflare → *Stockage et bases de données* → *D1* → **Créer** → nom : `souki-db`. Copier son **ID** (Database ID).
2. Sur GitHub, ouvrir `wrangler.jsonc` → crayon ✏️ → remplacer `COLLEZ-ICI-L-ID-DE-LA-BASE-D1` par cet ID → *Commit changes*.
3. Cloudflare relance la compilation tout seul (sinon : *Déploiements* → **Retry build**). Commande de déploiement : `npx wrangler deploy`, répertoire racine `/`.
4. Ouvrir l'adresse affichée dans *Vue d'ensemble* (du type `souki.<compte>.workers.dev`).

Ensuite, chaque modification envoyée sur GitHub est mise en ligne automatiquement.

## Limites du plan gratuit (largement suffisantes pour démarrer)

- 100 000 requêtes serveur par jour
- Base D1 : 5 Go, 5 millions de lectures et 100 000 écritures par jour
- Photos : 4 par annonce, compressées sur le téléphone avant l'envoi

## Sécurité

- Mots de passe chiffrés (PBKDF2-SHA256, 100 000 itérations), jamais stockés en clair.
- Blocage de 15 minutes après 5 mauvais mots de passe.
- Seul l'auteur d'une annonce peut la marquer vendue ou la supprimer.
- Maximum 30 annonces par compte et par jour.
