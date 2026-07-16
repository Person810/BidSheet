// Mirrors src/renderer/modules/underground/trenchCalc.ts byte-for-byte
// so the web tool and the app produce identical numbers.
var FIELDS = ['pipeSizeIn','startDepthFt','gradePct','runLengthLF','trenchWidthFt','benchWidthFt','beddingDepthFt'];
var DEFAULTS = { pipeSizeIn:8, startDepthFt:4, gradePct:2, runLengthLF:100, trenchWidthFt:3, benchWidthFt:0, beddingDepthFt:0.5 };

function round2(n) { return Math.round(n * 100) / 100; }

function validateInput(i) {
  var e = [];
  if (i.pipeSizeIn <= 0) e.push({ field:'pipeSizeIn', message:'Pipe size must be > 0' });
  if (i.startDepthFt <= 0) e.push({ field:'startDepthFt', message:'Starting depth must be > 0' });
  if (i.gradePct < 0) e.push({ field:'gradePct', message:'Grade cannot be negative — measure from the upstream (shallow) end' });
  if (i.runLengthLF <= 0) e.push({ field:'runLengthLF', message:'Run length must be > 0' });
  if (i.trenchWidthFt <= 0) e.push({ field:'trenchWidthFt', message:'Trench width must be > 0' });
  if (i.benchWidthFt < 0) e.push({ field:'benchWidthFt', message:'Bench width cannot be negative' });
  if (i.beddingDepthFt < 0) e.push({ field:'beddingDepthFt', message:'Bedding depth cannot be negative' });
  var pipeDiameterFt = i.pipeSizeIn / 12;
  if (pipeDiameterFt >= i.trenchWidthFt) e.push({ field:'trenchWidthFt', message:'Trench must be wider than pipe' });
  return e;
}

function calculateTrench(i) {
  var fallFt = (i.gradePct / 100) * i.runLengthLF;
  var pipeLF = Math.sqrt(Math.pow(i.runLengthLF, 2) + Math.pow(fallFt, 2));
  var endDepthFt = i.startDepthFt + fallFt;
  var avgDepthFt = (i.startDepthFt + endDepthFt) / 2;
  var totalWidthFt = i.trenchWidthFt + i.benchWidthFt * 2;
  var excavationCF = totalWidthFt * avgDepthFt * i.runLengthLF;
  var excavationCY = excavationCF / 27;
  var beddingCF = i.trenchWidthFt * i.beddingDepthFt * i.runLengthLF;
  var beddingCY = beddingCF / 27;
  var pipeRadiusFt = (i.pipeSizeIn / 12) / 2;
  var pipeCF = Math.PI * Math.pow(pipeRadiusFt, 2) * pipeLF;
  var backfillCF = Math.max(excavationCF - beddingCF - pipeCF, 0);
  var backfillCY = backfillCF / 27;
  return {
    pipeLF: round2(pipeLF),
    endDepthFt: round2(endDepthFt),
    avgDepthFt: round2(avgDepthFt),
    excavationCY: round2(excavationCY),
    beddingCY: round2(beddingCY),
    backfillCY: round2(backfillCY),
    tracerWireLF: round2(pipeLF),
    warningTapeLF: round2(i.runLengthLF)
  };
}

var form = document.getElementById('calc');
var results = document.getElementById('results');
var inputs = {};
FIELDS.forEach(function (f) { inputs[f] = document.getElementById(f); });

var OUT = {
  excavation: document.getElementById('out-excavation'),
  backfill: document.getElementById('out-backfill'),
  bedding: document.getElementById('out-bedding'),
  pipe: document.getElementById('out-pipe'),
  tracer: document.getElementById('out-tracer'),
  tape: document.getElementById('out-tape'),
  enddepth: document.getElementById('out-enddepth'),
  avgdepth: document.getElementById('out-avgdepth'),
  spoil: document.getElementById('out-spoil')
};

function blank() {
  for (var k in OUT) OUT[k].textContent = '—';
  results.classList.add('is-invalid');
}

function recalc() {
  var raw = {};
  var allFilled = true;
  FIELDS.forEach(function (f) {
    var v = parseFloat(inputs[f].value);
    raw[f] = v;
    if (!isFinite(v)) allFilled = false;
  });

  // Clear prior field errors
  FIELDS.forEach(function (f) {
    inputs[f].classList.remove('invalid');
    document.getElementById('err-' + f).textContent = '';
  });

  if (!allFilled) { blank(); return; }

  var errs = validateInput(raw);
  if (errs.length) {
    errs.forEach(function (e) {
      inputs[e.field].classList.add('invalid');
      var slot = document.getElementById('err-' + e.field);
      if (!slot.textContent) slot.textContent = e.message;
    });
    blank();
    return;
  }

  var r = calculateTrench(raw);
  results.classList.remove('is-invalid');
  OUT.excavation.textContent = r.excavationCY.toLocaleString();
  OUT.backfill.textContent = r.backfillCY.toLocaleString();
  OUT.bedding.textContent = r.beddingCY.toLocaleString();
  OUT.pipe.textContent = r.pipeLF.toLocaleString();
  OUT.tracer.textContent = r.tracerWireLF.toLocaleString();
  OUT.tape.textContent = r.warningTapeLF.toLocaleString();
  OUT.enddepth.textContent = r.endDepthFt.toLocaleString();
  OUT.avgdepth.textContent = r.avgDepthFt.toLocaleString();
  OUT.spoil.textContent = round2(r.excavationCY * 1.25).toLocaleString();
}

form.addEventListener('input', recalc);
document.getElementById('reset').addEventListener('click', function () {
  FIELDS.forEach(function (f) { inputs[f].value = DEFAULTS[f]; });
  recalc();
});
recalc();
