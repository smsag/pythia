// Verify that the Latin-script variant (ADR-199) produces the FULL model's
// vectors for Latin-script text — the claim everything else rests on: the
// desktop's index, the measured floors, and "a German question finds an
// English note" on the phone.
//
//   npm run model:verify -- [dist-models/latin] [--vault <dir>]
//
// Loads both models through @huggingface/transformers in Node (the same library
// Pythia bundles), embeds a fixed multilingual sentence set plus, with --vault,
// up to 400 chunks of real notes, and fails unless every pair has cosine ≥
// 0.9999 and identical token counts. Text in a non-Latin script is EXPECTED to
// differ and is reported separately, never counted as a failure.

import { readFileSync, readdirSync, existsSync, mkdirSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "dist-models/latin");
const vault = args.includes("--vault") ? args[args.indexOf("--vault") + 1] : null;
const UPSTREAM = "Xenova/paraphrase-multilingual-MiniLM-L12-v2";
const VARIANT = "verify/latin-variant";

if (!existsSync(join(dir, "onnx", "model_quantized.onnx"))) {
	console.error(`no model at ${dir} — run npm run model:prune first`);
	process.exit(2);
}

// transformers.js resolves local models under ONE root; stage the variant there.
const root = join(tmpdir(), "pythia-verify-models");
mkdirSync(join(root, "verify"), { recursive: true });
cpSync(dir, join(root, VARIANT), { recursive: true });

const { pipeline, env } = await import("@huggingface/transformers");
env.localModelPath = root;
env.allowRemoteModels = true; // the upstream model is fetched (and cached) from Hugging Face

const opts = { dtype: "q8" };
const full = await pipeline("feature-extraction", UPSTREAM, opts);
const variant = await pipeline("feature-extraction", VARIANT, opts);

const LATIN = [
	"Die Quartalsplanung verschiebt sich, weil das Datenschutzgutachten noch aussteht.",
	"Der Wasserhahn in der Gästetoilette tropft seit Dienstag unaufhörlich.",
	"Our onboarding funnel loses most users at the payment-details step.",
	"Photosynthesis converts light energy into chemical energy stored in glucose.",
	"La riunione di domani è stata spostata alle dieci per via dello sciopero.",
	"El presupuesto del proyecto se agotó antes de terminar la segunda fase.",
	"Le rapport annuel sera publié après la validation du conseil d'administration.",
	"O relatório trimestral ainda não foi aprovado pela diretoria.",
	"De vergadering is verplaatst naar donderdagmiddag vanwege de staking.",
	"Spotkanie zostało przełożone na przyszły tydzień z powodu choroby.",
	"Toplantı, grev nedeniyle perşembe öğleden sonraya ertelendi.",
	"Cuộc họp đã được dời sang chiều thứ Năm vì cuộc đình công.",
	"Kryptowährungen: Volatilität, Regulierung und Verwahrung im Überblick — 3 Punkte (siehe [[Notiz]]).",
];
const NON_LATIN = [
	"Встреча перенесена на четверг из-за забастовки.",
	"Η συνάντηση μετατέθηκε για την Πέμπτη λόγω της απεργίας.",
	"会議はストライキのため木曜日の午後に延期されました。",
];

const cos = (a, b) => { let d = 0, x = 0, y = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; } return d / Math.sqrt(x * y); };
async function compare(texts) {
	const out = [];
	for (const t of texts) {
		const [a, b] = await Promise.all([full(t, { pooling: "mean", normalize: true }), variant(t, { pooling: "mean", normalize: true })]);
		out.push({ text: t, cos: cos(a.data, b.data), sameTokens: full.tokenizer.encode(t).length === variant.tokenizer.encode(t).length });
	}
	return out;
}

const texts = [...LATIN];
if (vault) {
	const walk = (d) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			if (e.name.startsWith(".")) continue;
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".md") && texts.length < LATIN.length + 400) {
				const body = readFileSync(p, "utf8");
				for (let i = 0; i < body.length && texts.length < LATIN.length + 400; i += 422) {
					const c = body.slice(i, i + 422);
					if (c.trim() && !/[Ѐ-ӿͰ-Ͽ぀-ヿ一-鿿؀-ۿऀ-ॿ฀-๿]/.test(c)) texts.push(c);
				}
			}
		}
	};
	walk(vault);
}

const latin = await compare(texts);
const other = await compare(NON_LATIN);
const bad = latin.filter((r) => r.cos < 0.9999 || !r.sameTokens);
const min = Math.min(...latin.map((r) => r.cos));
console.log(`Latin-script: ${latin.length} texts, min cosine ${min.toFixed(6)}, ${latin.filter((r) => r.sameTokens).length} identical segmentations`);
console.log(`Other scripts (expected to differ): ${other.map((r) => r.cos.toFixed(3)).join(" · ")}`);
if (bad.length) {
	console.error(`FAIL — ${bad.length} Latin-script text(s) differ:`);
	for (const r of bad.slice(0, 10)) console.error(`  ${r.cos.toFixed(4)} ${r.sameTokens ? "" : "(resegmented)"} ${r.text.slice(0, 70)}`);
	process.exit(1);
}
console.log("OK — the variant is vector-identical to the full model for Latin-script text.");
