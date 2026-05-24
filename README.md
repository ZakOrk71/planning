# Planning Police — 3-3 / 2-2-3

Application web pour générer un planning de vacations (12h08) et gérer les congés.

## Deux modes de fonctionnement

**Mode profils (par défaut, rien à configurer)**
Chaque personne crée un profil ; son planning est sauvegardé dans **son navigateur**.
Parfait pour un usage perso ou sur poste partagé. Pas de synchro entre appareils
(mais export/import JSON possible).

**Mode comptes (email + mot de passe, synchronisé partout)**
Tu remplis tes 2 clés Supabase dans **`config-cloud.js`** → l'appli passe en mode comptes.
Chaque collègue crée un compte et retrouve son planning depuis téléphone, ordi, etc.
➜ Voir **`GUIDE-SUPABASE.md`** (gratuit, ~5 min). Le site peut rester sur GitHub Pages.

## Lancer
Double-clique sur **`index.html`** — ça s'ouvre dans le navigateur, rien à installer.

## Onglet Planning
1. Choisis la cadence : **3-3 (nuit)** ou **2-2-3 (jour)**.
2. Choisis le **1er jour travaillé** et la **fin** (par défaut 31/12).
3. Clique **Générer**. Le planning se calcule jusqu'à la date de fin.
4. Clique sur **n'importe quel jour** pour poser un congé (CA, RPS, RTC, CF, DA…),
   un stage ou du tir. Pour un **Départ Anticipé (DA)** tu saisis le nombre d'heures.

## Onglet Heures & calcul
- Saisis tes **heures restantes**.
- L'appli déduit ce que tu as déjà posé et affiche combien de **vacations (12h08)**
  tu peux encore poser.

## Onglet Congés & réglages
- Ajoute / supprime des types de congés.
- Exporte/Importe en **JSON** (`conges.json` ou sauvegarde complète).

## Fichiers
- **`index.html` / `style.css` / `app.js`** : l'application.
- **`config.json`** : durée de vacation (728 min = 12h08) et les cycles
  (`1` = travaillé, `0` = repos). Modifie le cycle si ta cadence réelle diffère.
- **`conges.json`** : la liste des congés/stages/tir.
- **`config-cloud.js`** : tes clés Supabase (laisser vide = mode profils).
- **`GUIDE-SUPABASE.md`** : comment activer les comptes.

> Planning indicatif : vérifie toujours avec ta hiérarchie / le service RH.
