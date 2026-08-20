# Guide Cloudflare — préparation du déploiement (fin du Sprint 0)

> Procédure clic par clic, à faire une seule fois. Durée : ~10 minutes.
> Objectif : permettre à la CI GitHub de déployer sur Cloudflare Pages.
> Prérequis : un compte Cloudflare (gratuit) — https://dash.cloudflare.com/sign-up si besoin.

## Étape 1 — Récupérer votre Account ID

1. Connectez-vous sur https://dash.cloudflare.com
2. Dans le menu de gauche, cliquez sur **Workers & Pages**.
3. Dans la colonne de droite de la page d'aperçu, repérez **Account ID**.
4. Cliquez sur **Copy** et gardez la valeur de côté (c'est un identifiant hexadécimal de 32 caractères ; ce n'est pas un secret sensible, mais on le mettra quand même en secret GitHub par propreté).

## Étape 2 — Créer le token API (scopé au minimum)

1. En haut à droite du dashboard, cliquez sur l'icône de profil → **My Profile**.
2. Onglet **API Tokens** → bouton **Create Token**.
3. Tout en bas, choisissez **Create Custom Token** → **Get started**.
4. Remplissez :
   - **Token name** : `labml-pages-deploy`
   - **Permissions** : `Account` · `Cloudflare Pages` · `Edit`  *(une seule ligne de permission suffit)*
   - **Account Resources** : `Include` · votre compte
   - (Optionnel, recommandé) **TTL** : définissez une date d'expiration et renouvelez le token à l'échéance.
5. **Continue to summary** → vérifiez qu'il n'y a que « Cloudflare Pages: Edit » → **Create Token**.
6. **Copiez le token immédiatement** : il n'est affiché qu'une seule fois.

> Principe du moindre privilège : ce token ne peut *que* gérer des projets Pages — il ne peut
> toucher ni au DNS, ni aux certificats, ni au reste du compte.

## Étape 3 — Ajouter les deux secrets dans GitHub

1. Ouvrez https://github.com/dapiced/LabML/settings/secrets/actions
   *(ou : dépôt **LabML** → **Settings** → **Secrets and variables** → **Actions**)*
2. Cliquez sur **New repository secret** :
   - **Name** : `CLOUDFLARE_API_TOKEN` — **Secret** : collez le token de l'étape 2 → **Add secret**
3. Recommencez :
   - **Name** : `CLOUDFLARE_ACCOUNT_ID` — **Secret** : collez l'Account ID de l'étape 1 → **Add secret**

C'est tout ce qui est nécessaire pour le premier déploiement : le workflow CI créera lui-même le
projet Pages (`wrangler pages project create labml`) au premier run — pas besoin de le créer à la main.
Le site sera d'abord accessible sur `labml.pages.dev` (URL de validation).

## Étape 4 — Plus tard : brancher le domaine `app.dominicdapice.com`

À faire seulement une fois le site validé sur `*.pages.dev` :

1. **Si `dominicdapice.com` n'est pas encore géré par Cloudflare** : dashboard → **Add a site** →
   entrez `dominicdapice.com` → plan **Free** → Cloudflare importe vos DNS existants (vérifiez que
   les enregistrements GitHub Pages de l'apex sont bien repris) → chez votre registrar, remplacez
   les serveurs de noms par les deux serveurs Cloudflare indiqués → attendre la propagation
   (quelques minutes à quelques heures). Votre site GitHub Pages continue de fonctionner à
   l'identique — seul l'hébergeur DNS change.
2. Dashboard → **Workers & Pages** → projet **labml** → onglet **Custom domains** →
   **Set up a custom domain** → entrez `app.dominicdapice.com` → **Activate domain**.
   Cloudflare crée l'enregistrement CNAME et le certificat SSL automatiquement.
3. Vérifiez : `https://app.dominicdapice.com` doit servir le site, cadenas SSL valide.

## Dépannage rapide

- **Erreur d'authentification dans la CI** : le token a expiré ou la permission n'est pas
  « Cloudflare Pages: Edit » → régénérez le token (étape 2) et mettez à jour le secret GitHub.
- **`pages.dev` fonctionne mais pas le domaine** : vérifiez l'onglet Custom domains du projet
  (statut « Active ») et que la zone `dominicdapice.com` est bien active sur Cloudflare.
- Les secrets GitHub ne sont jamais visibles après création (on peut seulement les remplacer) —
  c'est normal.
