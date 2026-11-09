# Souki (سوقي) — site web

Petites annonces pour la Mauritanie. Hébergement gratuit sur **Cloudflare Pages** avec une base de données **Cloudflare D1**.

## Contenu

| Dossier / fichier | Rôle |
|---|---|
| `public/index.html` | Le site (français / arabe) |
| `functions/api/[[path]].js` | Le serveur : comptes, annonces, photos, favoris, messages |
| `schema.sql` | Structure de la base (créée automatiquement au premier lancement) |

## Mise en ligne sur Cloudflare (une seule fois)

1. **Créer la base de données**
   Cloudflare → *Storage & Databases* → *D1* → **Create** → nom : `souki-db`.
2. **Créer le site**
   Cloudflare → *Workers & Pages* → **Create** → onglet *Pages* → **Connect to Git** → choisir le dépôt `souki`.
   - Framework preset : **None**
   - Build command : *(laisser vide)*
   - Build output directory : `public`
   → **Save and Deploy**.
3. **Relier la base au site**
   Projet `souki` → *Settings* → *Bindings* → **Add** → *D1 database* :
   - Variable name : `DB` (en majuscules)
   - D1 database : `souki-db`
   → **Save**.
4. **Relancer le déploiement**
   Onglet *Deployments* → sur le dernier déploiement, menu **⋯** → **Retry deployment**.
5. Ouvrir **https://souki.pages.dev** (ou le nom affiché par Cloudflare).

Ensuite, chaque modification envoyée sur GitHub est mise en ligne automatiquement en une minute environ.

## Limites du plan gratuit (largement suffisantes pour démarrer)

- 100 000 requêtes serveur par jour
- Base D1 : 5 Go, 5 millions de lectures et 100 000 écritures par jour
- Photos : 4 par annonce, compressées sur le téléphone avant l'envoi

## Sécurité

- Mots de passe chiffrés (PBKDF2-SHA256, 100 000 itérations), jamais stockés en clair.
- Blocage de 15 minutes après 5 mauvais mots de passe.
- Seul l'auteur d'une annonce peut la marquer vendue ou la supprimer.
- Maximum 30 annonces par compte et par jour.
