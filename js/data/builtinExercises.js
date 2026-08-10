// data/builtinExercises.js — a curated starter library (~90 common gym
// exercises) so a fresh install is immediately usable. PRESENTATION DATA ONLY:
// records use the existing exercise schema (no migration). Each has a STABLE
// deterministic id ("builtin:<slug>") so seeding is idempotent and history stays
// linked. Arabic name is primary (display), English is secondary + searchable.
//
// muscleGroup uses the Arabic broad-group vocabulary that domain/muscleMap.js
// already understands, so the muscle visualization lights up correctly. Equipment
// uses broad Arabic categories. No invented anatomy or activation percentages.

export const BUILTIN_VERSION = 1;

// [ nameAr, nameEn, muscleGroupAr, equipmentAr, extraAliases? ]
const M = 'جهاز', C = 'كيبل', D = 'دمبل', B = 'بار', EZ = 'EZ بار', BW = 'وزن الجسم';
const CHEST = 'صدر', BACK = 'ظهر', SH = 'أكتاف', BI = 'بايسبس', TRI = 'ترايسبس',
  QUAD = 'أمامية الفخذ', HAM = 'خلفية الفخذ', GLUTE = 'ألوية', CALF = 'سمانة',
  CORE = 'بطن', FORE = 'ساعد';

const DATA = [
  // ── Chest ──
  ['ضغط صدر', 'Chest Press (Machine)', CHEST, M],
  ['ضغط صدر مائل', 'Incline Chest Press (Machine)', CHEST, M],
  ['رفرفة صدر', 'Chest Fly (Machine)', CHEST, M, ['pec deck', 'peck deck']],
  ['بنش برس', 'Bench Press (Barbell)', CHEST, B, ['flat bench']],
  ['بنش برس مائل', 'Incline Bench Press (Barbell)', CHEST, B],
  ['بنش برس منحدر', 'Decline Bench Press (Barbell)', CHEST, B],
  ['بنش برس دمبل', 'Bench Press (Dumbbell)', CHEST, D],
  ['بنش برس مائل دمبل', 'Incline Bench Press (Dumbbell)', CHEST, D],
  ['رفرفة كيبل', 'Cable Fly', CHEST, C],
  ['رفرفة كيبل من أسفل لأعلى', 'Low-to-High Cable Fly', CHEST, C],
  ['رفرفة كيبل من أعلى لأسفل', 'High-to-Low Cable Fly', CHEST, C],
  ['ضغط بوش أب', 'Push Up', CHEST, BW, ['pushup']],
  ['غطس صدر', 'Chest Dip', CHEST, BW, ['dip']],

  // ── Back ──
  ['سحب علوي', 'Lat Pulldown (Cable)', BACK, C, ['pulldown']],
  ['سحب علوي قبضة واسعة', 'Wide Grip Lat Pulldown', BACK, C],
  ['سحب علوي قبضة ضيقة', 'Close Grip Lat Pulldown', BACK, C],
  ['سحب علوي قبضة محايدة', 'Neutral Grip Lat Pulldown', BACK, C],
  ['تجديف كيبل جالس', 'Seated Cable Row', BACK, C, ['row']],
  ['تجديف كيبل قبضة V', 'Seated Cable Row - V Grip', BACK, C],
  ['تجديف كيبل قبضة واسعة', 'Wide Grip Seated Row', BACK, C],
  ['تجديف بإسناد صدر', 'Chest Supported Row (Machine)', BACK, M],
  ['تجديف آلة أحادي', 'Iso-Lateral Row (Machine)', BACK, M],
  ['تجديف تي بار', 'T-Bar Row', BACK, B],
  ['تجديف بار', 'Barbell Row', BACK, B, ['bent over row']],
  ['تجديف دمبل بذراع', 'One Arm Dumbbell Row', BACK, D],
  ['سحب بذراع مستقيمة', 'Straight Arm Pulldown', BACK, C],
  ['عقلة بمساعدة', 'Assisted Pull Up', BACK, M],
  ['عقلة', 'Pull Up', BACK, BW, ['pullup']],
  ['عقلة قبضة عكسية', 'Chin Up', BACK, BW, ['chinup']],

  // ── Shoulders ──
  ['ضغط كتف', 'Shoulder Press (Machine)', SH, M, ['overhead press']],
  ['ضغط كتف دمبل', 'Shoulder Press (Dumbbell)', SH, D],
  ['ضغط كتف بار', 'Shoulder Press (Barbell)', SH, B, ['ohp', 'military press']],
  ['رفرفة جانبية دمبل', 'Lateral Raise (Dumbbell)', SH, D, ['side raise']],
  ['رفرفة جانبية كيبل', 'Lateral Raise (Cable)', SH, C],
  ['رفرفة جانبية جهاز', 'Lateral Raise (Machine)', SH, M],
  ['رفرفة خلفية جهاز', 'Rear Delt Reverse Fly (Machine)', SH, M, ['reverse pec deck']],
  ['رفرفة خلفية كيبل', 'Rear Delt Fly (Cable)', SH, C],
  ['سحب للوجه', 'Face Pull', SH, C, ['facepull']],
  ['رفعة أمامية', 'Front Raise', SH, D],

  // ── Biceps ──
  ['تمرين واعظ جهاز', 'Preacher Curl (Machine)', BI, M],
  ['تمرين واعظ EZ', 'Preacher Curl (EZ Bar)', BI, EZ],
  ['مرجحة بايسبس دمبل', 'Biceps Curl (Dumbbell)', BI, D, ['curl']],
  ['مرجحة بايسبس كيبل', 'Biceps Curl (Cable)', BI, C],
  ['مرجحة بار', 'Barbell Curl', BI, B],
  ['مرجحة EZ', 'EZ Bar Curl', BI, EZ],
  ['مرجحة مطرقية', 'Hammer Curl', BI, D, ['hammer']],
  ['مرجحة دمبل مائل', 'Incline Dumbbell Curl', BI, D],
  ['مرجحة بيزيان كيبل', 'Bayesian Cable Curl', BI, C],

  // ── Triceps ──
  ['دفع ترايسبس كيبل', 'Triceps Pushdown (Cable)', TRI, C, ['pushdown']],
  ['دفع ترايسبس حبل', 'Rope Pushdown (Cable)', TRI, C, ['rope']],
  ['تمديد ترايسبس علوي كيبل', 'Overhead Cable Triceps Extension', TRI, C],
  ['تمديد ترايسبس بذراع كيبل', 'Single-Arm Cable Triceps Extension', TRI, C],
  ['تحطيم الجمجمة', 'Skull Crusher (EZ Bar)', TRI, EZ, ['skullcrusher', 'lying triceps extension']],
  ['بنش قبضة ضيقة', 'Close Grip Bench Press', TRI, B],
  ['غطس ترايسبس', 'Triceps Dip', TRI, BW, ['dip']],

  // ── Legs / Glutes ──
  ['ضغط أرجل', 'Leg Press (Machine)', QUAD, M, ['legpress']],
  ['هاك سكوات', 'Hack Squat (Machine)', QUAD, M],
  ['تمديد أرجل', 'Leg Extension (Machine)', QUAD, M, ['quad extension']],
  ['ثني أرجل جالس', 'Seated Leg Curl (Machine)', HAM, M],
  ['ثني أرجل منبطح', 'Lying Leg Curl (Machine)', HAM, M],
  ['رفعة رومانية بار', 'Romanian Deadlift (Barbell)', HAM, B, ['rdl']],
  ['رفعة رومانية دمبل', 'Romanian Deadlift (Dumbbell)', HAM, D, ['rdl']],
  ['دفع الورك جهاز', 'Hip Thrust (Machine)', GLUTE, M],
  ['دفع الورك بار', 'Hip Thrust (Barbell)', GLUTE, B],
  ['جلوت درايف', 'Glute Drive (Machine)', GLUTE, M],
  ['تبعيد الورك', 'Hip Abduction (Machine)', GLUTE, M, ['abduction']],
  ['تقريب الورك', 'Hip Adduction (Machine)', QUAD, M, ['adduction']],
  ['رفعة سمانة واقف', 'Standing Calf Raise (Machine)', CALF, M],
  ['رفعة سمانة جالس', 'Seated Calf Raise (Machine)', CALF, M],
  ['سكوات بلغاري', 'Bulgarian Split Squat', QUAD, D, ['split squat']],
  ['سكوات كأس', 'Goblet Squat', QUAD, D],
  ['سكوات وزن الجسم', 'Bodyweight Squat', QUAD, BW, ['air squat']],
  ['سكوات بار', 'Back Squat (Barbell)', QUAD, B, ['squat']],
  ['رفعة ميتة بار', 'Deadlift (Barbell)', BACK, B, ['deadlift']],

  // ── Core ──
  ['كرنش كيبل', 'Cable Crunch', CORE, C],
  ['كرنش جهاز', 'Crunch (Machine)', CORE, M],
  ['رفع الأرجل معلق', 'Hanging Leg Raise', CORE, BW],
  ['رفع الأرجل', 'Leg Raise', CORE, BW],
  ['بلانك', 'Plank', CORE, BW],

  // ── Forearms ──
  ['ثني الرسغ', 'Wrist Curl', FORE, D],
  ['ثني الرسغ عكسي', 'Reverse Wrist Curl', FORE, D],
  ['مرجحة عكسية', 'Reverse Curl', FORE, EZ],
  ['ثني الرسغ كيبل', 'Cable Wrist Curl', FORE, C],
];

function slug(en) {
  return 'builtin:' + en.toLowerCase()
    .replace(/[()]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** The full starter library as ready-to-store records (status active, builtin). */
export const BUILTIN_EXERCISES = DATA.map(([nameAr, nameEn, muscleGroup, equipment, aliases = []]) => ({
  id: slug(nameEn),
  name: nameAr,               // primary display (existing list renders `name`)
  nameEn,                     // secondary display + search
  nameAr,                     // explicit
  muscleGroup,                // Arabic broad group (understood by muscleMap)
  equipment,                  // Arabic broad equipment
  defaultUnit: 'lb',
  machineId: null,
  notes: '',
  builtin: true,
  aliases: [nameEn, ...aliases],
  status: 'active',
}));
