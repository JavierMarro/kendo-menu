export interface GlossaryEntry {
  readonly id: string;
  readonly term: string;
  readonly definition: string;
  readonly aliases?: readonly string[];
  readonly note?: string;
}

/**
 * The main glossary is kept independent from the authored drill data so its explanations can be
 * written for a quick refresher without changing the names or contracts used by the menus.
 */
export const GLOSSARY_ENTRIES: readonly GlossaryEntry[] = Object.freeze([
  {
    id: 'ai-kakarigeiko',
    term: 'Ai-kakarigeiko',
    definition:
      'Mutual attacking practice in which both partners attack continuously, rather than one acting only as motodachi.',
    aliases: ['Ai kakarigeiko'],
  },
  {
    id: 'ai-kirikaeshi',
    term: 'Ai-kirikaeshi',
    definition: 'Kirikaeshi performed mutually by both partners at the same time.',
    aliases: ['Ai kirikaeshi'],
  },
  {
    id: 'ai-kote-men',
    term: 'Ai-kote-men',
    definition: 'A simultaneous kote exchange followed immediately by a men strike.',
  },
  {
    id: 'ai-men',
    term: 'Ai-men',
    definition: 'Both kendōka strike men at the same moment; the men-specific form of ai-uchi.',
    aliases: ['相面'],
    note: 'This is a sen-no-sen action: seizing the initiative as the attack begins.',
  },
  {
    id: 'ashi-sabaki',
    term: 'Ashi-sabaki',
    definition:
      'Kendo footwork: control and movement of the feet and legs, including suri-ashi, fumikomi, okuri-ashi, hiraki-ashi and ayumi-ashi.',
    aliases: ['Ashi sabaki'],
  },
  {
    id: 'big-kote-men',
    term: 'Big kote-men',
    definition: 'A large-motion kote-men combination that emphasizes full form and reach.',
  },
  {
    id: 'big-men',
    term: 'Big-men',
    definition:
      'Men with a full, large swing (furikaburi), usually taught before compact small-men.',
    aliases: ['Big men'],
  },
  {
    id: 'butsukarigeiko',
    term: 'Butsukarigeiko',
    definition:
      'A partnered drill of repeated men strikes and taiatari, building posture, attacking spirit and the ability to continue after the collision.',
  },
  {
    id: 'debana-kote',
    term: 'Debana-kote',
    definition:
      'Kote timed as the opponent begins an attack, before it develops; a debana oji-waza.',
    aliases: ['Debana kote', '出ばな小手'],
  },
  {
    id: 'debana-men',
    term: 'Debana-men',
    definition:
      'Men timed as the opponent begins an attack, before it develops; a debana oji-waza.',
    aliases: ['Debana men', '出ばな面'],
  },
  {
    id: 'dō',
    term: 'Dō',
    definition:
      'The torso or abdomen target, and the armor that protects it; one of kendo’s four valid striking areas.',
    aliases: ['Do', '胴'],
  },
  {
    id: 'dō-kirikaeshi',
    term: 'Dō-kirikaeshi',
    definition:
      'A kirikaeshi variant using dō strikes in place of, or alongside, the standard men pattern.',
    aliases: ['Do-kirikaeshi', 'Left-right Dō-kirikaeshi'],
    note: 'The menu’s “Left-right” label specifies alternating left and right dō strikes.',
  },
  {
    id: 'do-uchiotoshi-men',
    term: 'Do-uchiotoshi-men',
    definition:
      'Deflecting an attempted dō strike downward, then countering with men; Kihon 9 in the ZNKR bokutō kihon-waza set.',
    aliases: ['Dō-uchiotoshi-men', '胴打ち落とし面'],
  },

  {
    id: 'fast-kirikaeshi',
    term: 'Fast Kirikaeshi',
    definition: 'Kirikaeshi performed at increased tempo while retaining its pattern and form.',
  },

  {
    id: 'fumikomi',
    term: 'Fumikomi',
    definition: 'The stamping or lunging step timed with a strike to drive the cut forward.',
    aliases: ['踏み込み'],
  },
  {
    id: 'fumikomi-into-strike-drills',
    term: 'Fumikomi-into-strike drills',
    definition:
      'Footwork drills that isolate the transition from a fumikomi step directly into a strike.',
    note: 'A descriptive practice label rather than a single named waza.',
  },
  {
    id: 'fumikomi-three-directions',
    term: 'Fumikomi, three-directions',
    definition: 'A footwork drill that repeats fumikomi toward three directions.',
    aliases: ['3-direction fumikomi'],
    note: 'A descriptive menu label; the direction pattern can vary by dojo.',
  },
  {
    id: 'gyaku-do',
    term: 'Gyaku-do',
    definition:
      'Reverse dō: a strike to the left side of the dō rather than the standard right-side target.',
    aliases: ['Gyaku-dō', '逆胴'],
  },
  {
    id: 'harai-men',
    term: 'Harai-men',
    definition:
      'Sweeping the opponent’s shinai aside to open the line, then striking men; a harai-waza technique.',
    aliases: ['払い面'],
  },
  {
    id: 'haya',
    term: 'Haya',
    definition:
      'Quick suburi: advance on the strike and retreat on the raise in a rapid, continuous rhythm.',
    aliases: ['Hayasuburi', '速素振り'],
  },
  {
    id: 'hiki-do',
    term: 'Hiki-do',
    definition:
      'A dō strike delivered while stepping backward, usually from tsubazeriai; a hiki-waza.',
    aliases: ['Hiki do', 'Hiki-dō', '引き胴'],
  },
  {
    id: 'hiki-gyaku-do',
    term: 'Hiki-gyaku-do',
    definition: 'A backward hiki strike to gyaku-dō.',
    aliases: ['Hiki-gyaku-dō'],
  },
  {
    id: 'hiki-kote',
    term: 'Hiki-kote',
    definition:
      'A kote strike delivered while stepping backward, usually from tsubazeriai; a hiki-waza.',
    aliases: ['Hiki kote', '引き小手'],
  },
  {
    id: 'hiki-men',
    term: 'Hiki-men',
    definition:
      'A men strike delivered while stepping backward, usually from tsubazeriai; a hiki-waza.',
    aliases: ['Hiki men', '引き面'],
  },
  {
    id: 'ikkyodo',
    term: 'Ikkyodo',
    definition:
      'A strike completed in one unbroken motion, without pausing between raising the shinai and cutting.',
    aliases: ['Ikkyodō', 'Ikkyodo (one-hand)', '一挙動'],
    note: 'The menu’s “one-hand” label identifies a variation of this one-motion exercise.',
  },
  {
    id: 'jigeiko',
    term: 'Jigeiko',
    definition:
      'Free sparring in which both partners attack and defend without a prearranged script; applying technique matters more than winning.',
    aliases: ['地稽古'],
  },
  {
    id: 'jōdan',
    term: 'Jōdan',
    definition:
      'The high kamae, with the shinai raised above the head; one of kendo’s classical stances.',
    aliases: ['Jodan', 'Jōdan-no-kamae', 'jodan', '上段の構え'],
  },
  {
    id: 'joge',
    term: 'Joge',
    definition:
      'Up-down suburi: raise the shinai high overhead and swing down low as a shoulder-loosening warm-up.',
    aliases: ['Jōge', 'Jōge-buri', 'Jōge-suburi', '上下振り'],
  },
  {
    id: 'kaeshi-do',
    term: 'Kaeshi-do',
    definition: 'Receive an incoming strike and turn it into a counter to dō in one motion.',
    aliases: ['Kaeshi do', 'Kaeshi-dō', '返し胴'],
  },
  {
    id: 'kaeshi-men',
    term: 'Kaeshi-men',
    definition: 'Receive an incoming strike and turn it into a counter to men in one motion.',
    aliases: ['Kaeshi men', '返し面'],
  },
  {
    id: 'kakarigeiko',
    term: 'Kakarigeiko',
    definition:
      'Intensive, continuous attacking practice against a motodachi who holds a strong kamae and offers no target.',
    aliases: ['Kakari-geiko', '掛稽古'],
  },
  {
    id: 'katate-kote',
    term: 'Katate-kote',
    definition: 'A one-handed kote strike, often shown from a jōdan-type stance.',
    aliases: ['片手小手'],
  },
  {
    id: 'kihon-waza',
    term: 'Kihon-waza',
    definition:
      'Fundamental techniques: the basic men, kote, dō and tsuki actions on which combinations and counters build.',
    aliases: ['基本技'],
  },
  {
    id: 'kirikaeshi',
    term: 'Kirikaeshi',
    definition:
      'A core partnered drill: shōmen followed by alternating diagonal sayū-men strikes, often bracketed by taiatari.',
    aliases: ['切り返し'],
  },
  {
    id: 'kote',
    term: 'Kote',
    definition:
      'The forearm or wrist target, and the padded glove that protects it; one of kendo’s four valid striking areas.',
    aliases: ['小手'],
  },
  {
    id: 'kote-oji-waza-vs-jodan',
    term: 'Kote oji-waza vs. jodan',
    definition:
      'A menu-specific drill for applying an oji-waza response to an opponent using jōdan against the kote line.',
    aliases: ['Kote oji-waza vs. Jōdan'],
    note: 'The exact response is determined by the surrounding practice pattern.',
  },
  {
    id: 'kote-do',
    term: 'Kote-do',
    definition: 'A continuous combination of kote immediately followed by dō.',
    aliases: ['Kote-dō', '小手胴'],
  },
  {
    id: 'kote-kaeshi-men',
    term: 'Kote-kaeshi-men',
    definition: 'Receive or parry the opponent’s kote and immediately counter with men.',
    aliases: ['小手返し面'],
  },
  {
    id: 'kote-men',
    term: 'Kote-men',
    definition: 'The common continuous combination of kote immediately followed by men.',
    aliases: ['小手面'],
  },
  {
    id: 'kote-nuki-men',
    term: 'Kote-nuki-men',
    definition: 'Evade the opponent’s kote strike and immediately counter with men.',
    aliases: ['小手抜き面'],
  },
  {
    id: 'kote-suriage-men',
    term: 'Kote-suriage-men',
    definition: 'Slide the shinai upward to deflect an incoming kote, then counter with men.',
    aliases: ['小手すり上げ面'],
  },
  {
    id: 'kukan-datotsu',
    term: 'Kukan-datotsu',
    definition:
      'Solo practice of complete strikes, including fumikomi, against imagined men, kote, dō and tsuki targets.',
    aliases: ['Kukan-datotsu-men', '空間打突'],
  },
  {
    id: 'ladder-training',
    term: 'Ladder training',
    definition:
      'Agility-ladder footwork used for warm-up conditioning and quick, coordinated movement.',
    note: 'Imported athletic training rather than classical kendo terminology.',
  },
  {
    id: 'matawari',
    term: 'Matawari',
    definition: 'Deep hip and groin stretching combined with swinging practice.',
    aliases: ['Matawari-suburi', '股割り素振り'],
  },
  {
    id: 'match-speed-strikes',
    term: 'Match-speed strikes',
    definition:
      'Strikes practiced at a match-like pace so the technique remains coordinated under pressure.',
    aliases: ['"Match-speed" strikes'],
    note: 'A descriptive menu label; the precise pace and sequence are dojo-specific.',
  },
  {
    id: 'mawarigeiko',
    term: 'Mawarigeiko',
    definition:
      'Rotational practice in which partners take turns attacking and receiving, then change partners down the line.',
    aliases: ['回り稽古'],
  },
  {
    id: 'men',
    term: 'Men',
    definition:
      'The head or face target, and the helmet that protects it; a vertical centerline strike and one of kendo’s four valid targets.',
    aliases: ['面'],
  },
  {
    id: 'men-oji-waza-vs-jodan',
    term: 'Men oji-waza vs. jodan',
    definition:
      'A menu-specific drill for applying an oji-waza response to an opponent using jōdan against the men line.',
    aliases: ['Men oji-waza vs. Jōdan'],
    note: 'The exact response is determined by the surrounding practice pattern.',
  },
  {
    id: 'men-kaeshi-do',
    term: 'Men-kaeshi-do',
    definition: 'Receive the opponent’s men strike and turn it into a counter to dō.',
    aliases: ['面返し胴'],
  },
  {
    id: 'men-kirikaeshi',
    term: 'Men-kirikaeshi',
    definition: 'Kirikaeshi preceded by, or combined with, an initial men strike.',
    aliases: ['Men + kirikaeshi'],
  },
  {
    id: 'men-nuki-do',
    term: 'Men-nuki-do',
    definition: 'Evade an incoming men strike and immediately counter with dō.',
    aliases: ['Nuki-do', 'Nuki-dō', '面抜き胴'],
  },
  {
    id: 'men-suriage-men',
    term: 'Men-suriage-men',
    definition:
      'Slide the shinai upward to deflect an incoming men, then immediately counter with men.',
    aliases: ['面すり上げ面'],
  },
  {
    id: 'morote-men',
    term: 'Morote-men',
    definition:
      'A men strike using the standard two-handed grip, contrasted with katate technique.',
    aliases: ['Morote men', '諸手面'],
  },
  {
    id: 'morote-tsuki',
    term: 'Morote-tsuki',
    definition: 'A tsuki delivered with both hands on the tsuka.',
    aliases: ['諸手突き'],
  },
  {
    id: 'moshiawase',
    term: 'Moshiawase',
    definition:
      'A semi-free format agreed in advance, where the kakarite chooses which technique to attempt.',
    aliases: ["Moshiawase (kakarite's choice)", 'Moshiawase oji-waza', '申し合わせ'],
  },
  {
    id: 'one-breath-kirikaeshi',
    term: 'One-breath Kirikaeshi',
    definition:
      'Kirikaeshi performed continuously in a single breath and kiai, without pausing to inhale.',
    aliases: ['One-breath kirikaeshi', 'One-breath-kirikaeshi'],
  },
  {
    id: 'one-leg-suburi',
    term: 'One-leg suburi',
    definition: 'Suburi performed while balancing on one leg to add a stability challenge.',
  },
  {
    id: 'one-step-advances',
    term: 'One-step advances',
    definition:
      'A footwork drill that isolates one advancing step before steps are chained together.',
  },
  {
    id: 'pattern-geiko',
    term: 'Pattern-geiko',
    definition: 'Repeated practice of prearranged attack-and-response combinations.',
  },
  {
    id: 'position-swap-suri-ashi',
    term: 'Position-swap suri-ashi',
    definition: 'A suri-ashi drill in which partners exchange positions while moving.',
    note: 'A descriptive menu format combining sliding footwork with partner awareness.',
  },
  {
    id: 'sankyodo-shomen',
    term: 'Sankyodo-shomen',
    definition:
      'Three-count shōmen suburi: raise, cut with correct form, then settle into a zanshin or chūdan finish.',
    aliases: ['Sankyodō-shōmen', '三挙動正面'],
  },
  {
    id: 'sashi-men',
    term: 'Sashi-men',
    definition:
      'A men attack made with a more thrusting, compact action and less wrist or shoulder movement than a full cut.',
    aliases: ['刺し面'],
    note: 'Its use and teaching emphasis vary by dojo.',
  },
  {
    id: 'sayu-men',
    term: 'Sayu-men',
    definition:
      'An angled strike to the upper-left or upper-right of the men rather than straight down the centerline.',
    aliases: ['Sayū-men', '左右面'],
  },
  {
    id: 'sayu-two-step-eight-directions',
    term: 'Sayu, two-step eight-directions',
    definition:
      'A drill combining sayū striking with a two-step movement pattern across eight directions.',
    aliases: ['Sayu 2-step 8-directions'],
    note: 'A descriptive menu format; the exact path is dojo-specific.',
  },
  {
    id: 'seme-ashi-men',
    term: 'Seme-ashi-men',
    definition: 'A men strike practiced with seme-ashi, so forward pressure leads into the cut.',
    aliases: ['Seme ashi men'],
  },
  {
    id: 'seme-men',
    term: 'Seme-men',
    definition: 'A men strike in which seme or forward pressure is established before the cut.',
    aliases: ['Seme men'],
  },
  {
    id: 'shiaigeiko',
    term: 'Shiaigeiko',
    definition:
      'Practice under shiai rules, with participants consciously trying to score and win as in a match.',
    aliases: ['試合稽古'],
  },
  {
    id: 'shomen',
    term: 'Shomen',
    definition: 'A straight centerline strike to the front of the men.',
    aliases: ['Shōmen', '正面'],
  },
  {
    id: 'shomen-two-step-four-directions',
    term: 'Shomen, two-step four-directions',
    definition:
      'A shōmen-suburi variant combining the straight strike with two-step movement across four directions.',
    aliases: ['Shomen 2-step 4-directions'],
    note: 'A descriptive menu format; the exact path is dojo-specific.',
  },
  {
    id: 'slow-kirikaeshi',
    term: 'Slow Kirikaeshi',
    definition:
      'Kirikaeshi performed deliberately slowly to prioritize distance, form and posture.',
  },
  {
    id: 'small-men',
    term: 'Small-men',
    definition: 'A compact men strike used after full-swing form has been established.',
    aliases: ['Small men'],
  },
  {
    id: 'stationary-kote-men',
    term: 'Stationary Kote-men',
    definition:
      'The kote-men combination practiced from a fixed standing position to isolate upper-body mechanics.',
  },
  {
    id: 'stretch',
    term: 'Stretch',
    definition: 'General warm-up stretching before kendo-specific movement and striking practice.',
    note: 'A conditioning label rather than a named kendo technique.',
  },
  {
    id: 'suburi',
    term: 'Suburi',
    definition:
      'Solo swinging exercises with a shinai or bokutō that build the foundation of cutting mechanics.',
    aliases: ['素振り'],
  },
  {
    id: 'suri-ashi',
    term: 'Suri-ashi',
    definition:
      'Sliding footwork in which the feet stay close to the floor while the body moves smoothly.',
    aliases: ['Suri-ashi drills'],
  },
  {
    id: 'suri-ashi-kirikaeshi',
    term: 'Suri-ashi-kirikaeshi',
    definition:
      'Kirikaeshi performed while advancing and retreating with continuous suri-ashi footwork.',
    aliases: ['Suri-ash-kirikaeshi', 'Kirikaeshi + suri-ashi'],
  },
  {
    id: 'taiatari',
    term: 'Taiatari',
    definition:
      'A controlled body check that uses the legs to disrupt the opponent’s posture and balance.',
    aliases: ['体当たり'],
  },
  {
    id: 'taisabaki-joge',
    term: 'Taisabaki-joge',
    definition:
      'Joge-suburi combined with tai-sabaki, adding body repositioning or off-line movement.',
  },
  {
    id: 'tsuki',
    term: 'Tsuki',
    definition: 'A thrust to the throat target; one of kendo’s four valid striking areas.',
    aliases: ['突き'],
  },
  {
    id: 'tsuki-kirikaeshi',
    term: 'Tsuki-kirikaeshi',
    definition:
      'Kirikaeshi performed with an initial tsuki before the alternating men-strike sequence.',
    aliases: ['Tsuki + kirikaeshi'],
  },
  {
    id: 'tsuki-kote',
    term: 'Tsuki-kote',
    definition: 'A continuous combination of tsuki immediately followed by kote.',
    aliases: ['突き小手'],
  },
  {
    id: 'tsuki-men',
    term: 'Tsuki-men',
    definition: 'A continuous combination of tsuki immediately followed by men.',
    aliases: ['突き面'],
  },
  {
    id: 'uchikomi',
    term: 'Uchikomi',
    definition:
      'Striking practice in which the motodachi offers openings so the kakarite can focus on decisive technique without a counter.',
    aliases: ['Uchikomi-geiko', 'Uchikomi (Men only)', 'Motodachi-geiko', '打ち込み'],
  },
  {
    id: 'warm-up',
    term: 'Warm-up',
    definition:
      'General loosening and conditioning, such as stretching, light footwork and joint mobility, before practice.',
    aliases: ['Warm up', 'Taisō'],
  },
  {
    id: 'zenshin-kōtai-shomen',
    term: 'Zenshin-kōtai Shomen',
    definition:
      'Advance-retreat shōmen suburi: strike while stepping forward and backward to train cutting form on the move.',
    aliases: ['Zenshin-kotae shomen', 'Zenshin-kōtai shōmen'],
    note: 'The source menu spells “kōtai” as “kotae”; kōtai means retreat or withdrawal.',
  },
]);

/**
 * Useful category vocabulary that appears as an umbrella activity in the menus. These terms are
 * kept separate because they do not occur as standalone leaf exercises in the curated collection.
 */
export const GLOSSARY_GROUP_TERMS: readonly GlossaryEntry[] = Object.freeze([
  {
    id: 'debana-waza',
    term: 'Debana-waza',
    definition: 'Oji-waza performed as the opponent’s attack is just beginning to form.',
    aliases: ['出ばな技'],
  },
  {
    id: 'hiki-waza',
    term: 'Hiki-waza',
    definition: 'Techniques delivered while stepping backward, commonly from tsubazeriai.',
    aliases: ['引き技'],
  },
  {
    id: 'ken-tore',
    term: 'Ken-tore',
    definition:
      'Strength and conditioning practice using bodyweight or kendo-specific movement stations.',
    aliases: ['Ken-tore circuit'],
  },
  {
    id: 'kubun-geiko',
    term: 'Kubun-geiko',
    definition:
      'Segmented practice that rotates a group through clearly separated roles or exercises.',
    aliases: ['区分稽古'],
  },
  {
    id: 'oikomi-geiko',
    term: 'Oikomi-geiko',
    definition:
      'A drill in which the motodachi retreats rapidly while the kakarite continues striking and matching fumikomi to the retreat.',
    aliases: ['追い込み稽古'],
  },
  {
    id: 'oji-waza',
    term: 'Oji-waza',
    definition:
      'Responding techniques: counter-attacks performed in reaction to an opponent’s attack.',
    aliases: ['応じ技'],
  },
  {
    id: 'renzoku-waza',
    term: 'Renzoku-waza',
    definition:
      'Continuous techniques in which two or more strikes are delivered in immediate succession.',
    aliases: ['連続技'],
  },
  {
    id: 'sandan-geiko',
    term: 'Sandan-geiko',
    definition:
      'Three-level practice in which the kakarite cycles through three motodachi in succession.',
    aliases: ['三段稽古'],
  },
  {
    id: 'shikake-waza',
    term: 'Shikake-waza',
    definition: 'Initiating techniques used to start an attack or create an attacking opportunity.',
    aliases: ['仕掛け技'],
  },
  {
    id: 'waza-geiko',
    term: 'Waza-geiko',
    definition: 'Technique practice focused on a set of named waza rather than free sparring.',
    aliases: ['技稽古'],
  },
  {
    id: 'yakusoku-geiko',
    term: 'Yakusoku-geiko',
    definition:
      'Prearranged practice in which partners agree the technique or response before repeating it.',
    aliases: ['約束稽古'],
  },
]);
