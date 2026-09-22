import { PostMessageEmbeddingProvider, type BackendChannel, type BackendMessage, type ModelLoadProgress } from "./postMessageBackend";
import { getEmbeddingBundle } from "./embeddingBundle";

export type { ModelLoadProgress };

/**
 * Runs the embedding model inside a hidden same-origin iframe (about:srcdoc), the
 * same isolation obsidian-similarity uses: the heavy transformers.js/WASM runtime
 * lives off the plugin's own context, and `main.js` carries only the bundled
 * bootstrap as a string. The LAST resort in the backend chain — inference here
 * shares Obsidian's UI thread, which is why callers throttle a build on it.
 *
 * The conversation with the backend is `PostMessageEmbeddingProvider` (ADR-204);
 * what is here is how the iframe is mounted and removed. That split is the point:
 * this path is runtime-only — a unit test cannot reach it, it needs a real
 * Obsidian window — so it should hold as little of its own logic as possible.
 */
export class IframeEmbeddingProvider extends PostMessageEmbeddingProvider {
	protected readonly label = "Embedding iframe";

	/** Same-origin iframe → inference runs on the renderer UI thread, not off it. */
	isOffThread(): boolean {
		return false;
	}

	protected async mount(): Promise<BackendChannel> {
		const configJson = JSON.stringify(this.config).replace(/</g, "\\u003c");
		// Wrap the shared backend bundle in a module <script> at runtime; escape any
		// "</script" so it can't terminate the srcdoc script early.
		const moduleScript = `<script type="module">\n${getEmbeddingBundle().replace(/<\/script/gi, "<\\/script")}\n</script>`;
		const srcdoc = `<script>window.__EMBEDDING_MODEL_CONFIG__ = ${configJson};</script>\n${moduleScript}\n`;

		const iframe = document.createElement("iframe");
		iframe.setAttribute("style", "display: none;");
		iframe.srcdoc = srcdoc;
		document.body.appendChild(iframe);

		const onMessage = (event: MessageEvent): void => {
			if (event.origin !== window.location.origin) return;
			if (event.source !== iframe.contentWindow) return;
			this.receive(event.data as BackendMessage);
		};
		window.addEventListener("message", onMessage);

		return {
			send: (message) => {
				const win = iframe.contentWindow;
				// Removed from the document under us; the caller turns this into a
				// failed request rather than one that waits out its timeout.
				if (!win) throw new Error("Embedding iframe is not available");
				win.postMessage(message, window.origin);
			},
			close: () => {
				window.removeEventListener("message", onMessage);
				iframe.remove();
			},
		};
	}
}
