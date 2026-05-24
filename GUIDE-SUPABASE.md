# Activer les comptes (email + mot de passe) — Guide Supabase

L'appli marche **sans rien faire** en mode "profils" (sauvegarde dans le navigateur).
Pour avoir de **vrais comptes synchronisés sur tous les appareils**, suis ce guide (~5 min, gratuit).
Le site peut rester sur **GitHub Pages** : Supabase ne sert que de base de données + comptes.

---

## 1. Créer un projet Supabase
1. Va sur **https://supabase.com** → **Start your project** → connecte-toi (GitHub ou email).
2. **New project** :
   - Nom : `planning-police` (ce que tu veux)
   - **Database Password** : choisis-en un et **note-le** quelque part.
   - **Region** : `West EU (Paris)` ou `Central EU` (le plus proche).
   - Plan : **Free**.
3. Clique **Create new project** et attends ~2 minutes que ça s'installe.

## 2. Récupérer tes 2 clés
1. Dans le menu de gauche : **Project Settings** (la roue dentée) → **API**.
2. Copie :
   - **Project URL** → ressemble à `https://abcd1234.supabase.co`
   - **Project API keys → `anon` `public`** → une longue clé qui commence par `eyJ...`
3. Ouvre le fichier **`config-cloud.js`** et colle-les :
   ```js
   window.SUPABASE_URL = "https://abcd1234.supabase.co";
   window.SUPABASE_ANON_KEY = "eyJhbGciOi....";
   ```
   > La clé `anon public` est faite pour être publique, aucun souci à la mettre dans le code.
   > Les données restent protégées par les règles de sécurité de l'étape 3.

## 3. Créer la table + sécurité
1. Menu de gauche → **SQL Editor** → **New query**.
2. Colle ceci et clique **Run** :
   ```sql
   create table if not exists public.plannings (
     user_id    uuid primary key references auth.users(id) on delete cascade,
     data       jsonb,
     updated_at timestamptz default now()
   );

   alter table public.plannings enable row level security;

   create policy "Chacun accede a ses donnees"
     on public.plannings
     for all
     using (auth.uid() = user_id)
     with check (auth.uid() = user_id);
   ```
   Cette règle garantit que **chaque personne ne voit que son propre planning**.

## 4. (Recommandé) Connexion immédiate sans mail de confirmation
Par défaut, Supabase envoie un email de confirmation. Pour des collègues, c'est souvent plus simple de désactiver ça :
1. Menu → **Authentication** → **Sign In / Providers** (ou **Providers → Email**).
2. Désactive **"Confirm email"** (Enregistre).
   → Les comptes peuvent se connecter directement après inscription.

Si tu **gardes** la confirmation activée :
- Menu → **Authentication** → **URL Configuration** → mets l'adresse de ton site
  (ex. `https://tonpseudo.github.io/planning-police/`) dans **Site URL**.

## 5. Mettre en ligne sur GitHub Pages
1. Crée un repo GitHub, mets-y **tous les fichiers** (dont `config-cloud.js` rempli).
2. **Settings → Pages → Source : branche `main`, dossier `/root`** → Save.
3. Au bout d'1-2 min, ton appli est sur `https://tonpseudo.github.io/le-repo/`.

C'est fini : chacun clique sur **Créer un compte**, et retrouve son planning depuis n'importe quel appareil.

---

### Limites du plan gratuit Supabase
Largement suffisant ici : 50 000 utilisateurs actifs/mois et 500 Mo de base. Un planning = quelques Ko.

### Et si je veux un planning d'ÉQUIPE partagé (voir les collègues) ?

C'est inclus ! Pour l'activer :
1. Ouvre **SQL Editor → New query** dans Supabase.
2. Copie tout le contenu du fichier **`team.sql`** (fourni) et clique **Run**.

Ça crée les brigades + les règles de sécurité (chacun ne voit que les plannings
des collègues qui sont **dans la même brigade**).

Ensuite, dans l'appli, onglet **Équipe** :
- **Créer une brigade** → un **code** est généré, tu le donnes aux collègues.
- **Rejoindre** → ils entrent le code.
- **Voir** → grille mensuelle : une ligne par membre, vacations / repos / congés en couleur.

> Chacun reste maître de son planning ; les autres le voient seulement en lecture.
