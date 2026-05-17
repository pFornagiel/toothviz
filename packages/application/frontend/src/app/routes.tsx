import { createBrowserRouter } from "react-router";
import { StartPage } from "./pages/StartPage";
import { StudyBrowsePage, browseLoader } from "./pages/StudyBrowsePage";
import { PipelinePage, pipelineLoader } from "./pages/PipelinePage";
import { VisualizationPage, visualizationLoader } from "./pages/VisualizationPage";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: StartPage,
  },
  {
    path: "/browse",
    loader: browseLoader,
    Component: StudyBrowsePage,
  },
  {
    path: "/pipeline/:studyId",
    loader: pipelineLoader,
    Component: PipelinePage,
  },
  {
    path: "/visualize/:studyId?",
    loader: visualizationLoader,
    Component: VisualizationPage,
  },
]);
