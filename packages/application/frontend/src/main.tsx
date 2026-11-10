import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import { backendOrigin } from "./api/baseUrl";
import "./styles/index.css";

// Resolve the Electron backend port now, while ?toothBackendPort= is still in
// the URL; the first in-app navigation drops the query string.
backendOrigin();

createRoot(document.getElementById("root")!).render(<App />);
