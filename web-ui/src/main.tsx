import ReactDOM from "react-dom/client";

import App from "@/App";
import "@/styles/globals.css";

const root = document.getElementById("root");
if (!root) {
	throw new Error("Root element was not found.");
}

ReactDOM.createRoot(root).render(<App />);
