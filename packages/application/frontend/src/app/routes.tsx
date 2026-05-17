import { createBrowserRouter } from "react-router";
import { StartPage } from "./pages/StartPage";
import { StudyBrowsePage } from "./pages/StudyBrowsePage";
import { PipelinePage } from "./pages/PipelinePage";
import { VisualizationPage } from "./pages/VisualizationPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: StartPage,
  },
  {
    path: "/browse",
    Component: StudyBrowsePage,
  },
  {
    path: "/pipeline/:studyId",
    Component: PipelinePage,
  },
  {
    path: "/visualize/:studyId?",
    Component: VisualizationPage,
  },
]);
