# Notes pour la démo (3 minutes)

## L'idée, en une phrase

Mes écoutes sont une spirale du temps : chaque tour est une demi-heure, quatre heures ou un jour, chaque pochette une écoute, et une toile de fils gris montre ce qui relie les morceaux entre eux. La même musique, vue autrement, devient un réseau dans un globe.

Inspirations : l'affiche « Interaktionsgestaltung » de la HfG Schwäbisch Gmünd (une frise chronologique en spirale, avec des vignettes posées sur un ruban vert et un titre en blocs blancs), et les visualiseurs de graphes hyperboliques (un arbre en éventails dans une sphère en fil de fer).

## Comment lire la spirale

| Ce qu'on voit | Ce que ça veut dire | Où c'est calculé |
|---|---|---|
| un tour de ruban | une durée ronde (10 min … 30 jours), choisie pour que la spirale aille de ma première écoute de la période à maintenant en 4 à 7 tours | `buildSpiral` dans `web/scene.js` |
| hauteur sur la spirale | il y a combien de temps : le ruban commence à maintenant (le bout en haut, avec un rond et `NOW`) et descend vers le passé | `spiralPoint` dans `web/scene.js` |
| pochette | une écoute ; plus l'artiste est écouté, plus elle est grande | `drawSpiral` dans `web/scene.js` |
| drapeau | début d'un tour (`Tue 17`, `14:30`) ; dans « All », la durée d'un tour s'adapte pour étaler les écoutes sur environ 8 tours | `marks` dans `buildSpiral` |
| fils verticaux | de chaque pochette au tour du dessous, comme sur l'affiche | `drawSpiral` |
| faisceaux qui se croisent au centre | les écoutes d'un même style, tirées vers un point de l'axe | `foci` dans `buildSpiral` |
| courbes entre pochettes | deux écoutes d'artistes qui partagent des tags Last.fm (3 par écoute) ; la courbe passe par l'axe, pour rester visible même entre deux pochettes voisines | `corr` dans `buildSpiral` |
| rond au bout du ruban, `NOW` | maintenant ; avec la pochette qui joue (`nowplaying`), si une chanson joue | `drawNowSpiral` |

## Comment lire la sphère

| Ce qu'on voit | Ce que ça veut dire |
|---|---|
| le centre | maintenant ; le grand éventail rose va vers les morceaux des dernières 24 h |
| points nommés en majuscules | les styles, trouvés d'après les tags (`classify` dans `server/shaping.py`) |
| gros points | mes artistes, plus gros s'ils sont plus écoutés |
| éventails colorés autour d'un artiste | ses morceaux (carrés), une écoute par petit point, ses tags (blancs), ses artistes proches (ronds) |
| losanges et cercles blancs à l'intérieur | des ponts : un tag ou un artiste proche partagé par plusieurs de mes artistes |
| arcs verts | deux artistes que j'écoute et que Last.fm trouve proches |

Tout est calculé dans `buildGraph` et dessiné dans `drawSphere` (`web/scene.js`). Au survol, le reste s'efface et les noms sont placés sans se chevaucher ; au clic, la caméra vole vers l'artiste (`flyTo` : on tourne le globe pour que l'artiste soit en face, puis on zoome).

La spirale s'adapte aux écoutes : quelle que soit la fenêtre, elle va de la première écoute de la période à maintenant, en 4 à 7 tours d'une durée ronde. Les pochettes trop proches dans le temps sont écartées en groupe, centrées sur leurs heures (`spreadTiles`), et un trait fin montre l'heure exacte de celles qui ont dû bouger. Les pochettes grandissent moins vite que la spirale quand on zoome : de loin elles forment des bandes, de près elles glissent vers leur heure. Le curseur « Coil / Stretch » change seulement le pas entre deux tours : la spirale pend depuis maintenant comme un ressort.

## Wrapped

Sous le dessin, la période en quelques chiffres (`web/stats.js`) : écoutes, temps estimé, artiste et chanson les plus écoutés, top 5, styles, heure la plus chargée, plus longue série d'un même artiste, plus longue session (écoutes à moins de 20 min d'intervalle). Last.fm ne donne pas la durée des morceaux : le temps est estimé à 3 min 30 par écoute, et la page le dit.

## Le chemin d'une requête

1. Le navigateur demande `/api/map` à **mon** serveur. Jamais Last.fm.
2. Le serveur regarde son cache : si la réponse a moins de 120 s, il la renvoie (`X-Cache: hit`).
3. Sinon il appelle `user.getRecentTracks` (`X-Cache: miss`), garde la réponse en mémoire et sur disque.
4. Pour les artistes nouveaux seulement, il demande leurs tags (`artist.getTopTags`) et leurs artistes proches (`artist.getSimilar`), gardés 14 jours.
5. Il renvoie un JSON : styles, artistes, écoutes, artistes proches. Les pochettes ont un identifiant, et le navigateur les demande à `/api/cover/<id>`.
6. La page compte les écoutes selon la période (3 h, 24 h, 7 jours, tout) et dessine sur un `<canvas>`.

## Les six critères, et comment les prouver

1. **Une forme choisie, pas une liste** : la spirale et la sphère. Les pochettes en grille et le tableau existent aussi, en dessous, pour le téléphone et l'accessibilité.
2. **Aucune requête vers Last.fm dans l'onglet Network** : ouvrir l'onglet, recharger, tout va vers `localhost:8080`, pochettes comprises. Bonus : l'en tête `Content-Security-Policy` interdit au navigateur de contacter une autre adresse.
3. **La clé n'est pas sur GitHub** : elle est dans `.env`, ignoré par Git. Le serveur la lit avec `os.environ`. Elle n'apparaît ni dans les logs (on n'écrit que le nom de la méthode) ni dans les erreurs. Preuve : `git log -p --all | grep -c <clé>` affiche 0.
4. **Deux rechargements, un seul appel** : `curl -s -D - -o /dev/null localhost:8080/api/map | grep -i x-cache` deux fois : `miss` puis `hit`. `/api/health` compte les appels par méthode : `user.getRecentTracks` reste à 1.
5. **Last.fm injoignable** : la page garde les dernières écoutes et le dit. Sans aucune donnée, un message s'affiche avec un bouton pour réessayer. Démo : `LASTFM_API_ROOT=http://10.255.255.1/ RECENT_TTL=1 docker compose up -d`.
6. **`docker compose up` sur une copie neuve** : pas de dépendance à installer, et sans `.env` l'appli démarre en mode démo au lieu de planter.

## Questions probables

**Au premier chargement, `/api/health` montre aussi des appels `artist.getTopTags` et `artist.getSimilar` : ça casse la règle ?** Non : les écoutes, elles, sont demandées une seule fois. Tags et artistes proches sont demandés une seule fois **par artiste nouveau**, puis gardés 14 jours sur disque (dans le volume Docker). Au deuxième rechargement : zéro appel. Le serveur attend les tags au plus 4 secondes et n'attend jamais les artistes proches : ils arrivent en arrière plan et la page redemande 6 secondes après.

**Pourquoi le serveur et pas directement le navigateur vers Last.fm ?** Pour cacher la clé, et pour que cent visiteurs ne fassent pas cent appels : le serveur est le seul client de Last.fm.

**Que se passe t il si dix personnes chargent la page en même temps quand le cache expire ?** Un verrou (`threading.Lock` dans `service.py`) fait qu'une seule requête appelle Last.fm ; les autres attendent et reçoivent la même réponse.

**Comment est faite la 3D, sans bibliothèque ?** À la main dans `scene.js`. Pour la spirale : l'angle dépend du temps, `x = R cos(a)`, `z = R sin(a)`, la hauteur descend d'un pas par tour ; on regarde un peu d'en haut (`TILT`) avec une petite perspective (`5 / (5 - z)`). Les morceaux de ruban et les pochettes sont triés par profondeur avant d'être dessinés, pour que l'avant cache l'arrière. Pour la sphère : deux rotations (lacet, tangage), puis la même perspective. Le zoom multiplie l'échelle, et zoomer sous le curseur déplace le centre pour garder ce point fixe (`zoomAt`).

**Pourquoi un `<canvas>` et pas du SVG ?** Des centaines de pochettes et plus d'un millier de fils, redessinés à chaque image pendant la rotation : le canvas est plus léger.

**Et si Last.fm renvoie une erreur 200 avec un message ?** Last.fm met parfois `{"error": ...}` dans une réponse 200 ; `lastfm.py` le vérifie. Autre piège : quand il n'y a qu'une chanson, Last.fm renvoie un objet au lieu d'une liste.

**Pourquoi les pochettes passent par le serveur ?** Les images viennent de `lastfm.freetls.fastly.net` ou `lastfm-img.freetls.fastly.net`, qui apparaîtraient dans l'onglet Network. Le serveur ne télécharge que les adresses venues de Last.fm (liste d'hôtes autorisés), une seule fois, puis les garde sur disque.

## Limites, à dire franchement

- Les styles viennent des tags Last.fm, écrits par les utilisateurs : un artiste peut tomber dans « Autre » ou dans un style discutable.
- Un seul utilisateur, fixé dans `.env`. Le « mur d'amis » serait une suite naturelle.
- Last.fm renvoie au plus 200 écoutes par appel : au delà, les plus anciennes ne sont pas dessinées.
- Avec peu d'écoutes, la sphère se remplit surtout grâce aux tags et aux artistes proches : c'est le voisinage de ma musique, pas seulement ma musique.
