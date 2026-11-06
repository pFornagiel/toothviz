import { ThemeProvider } from "next-themes";
import { RouterProvider } from "react-router";
import { router } from "./routes";

export default function App() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="toothviz-theme">
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}
