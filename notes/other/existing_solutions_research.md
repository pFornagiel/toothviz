## APP

When it comes to app-ish solutions, I found:

---

### VolViz

[volviz - library](https://libraries.io/pypi/volviz) | [VolViz - github](https://github.com/RJPaneque/volviz)

This is not app, but it provides similar funtionalities when it comes to displaying images. 
It's lightweight, volumetric image visualization tool, e.g. for CT images (mostly used in Jupyter Notebook and Google Colab). Enables coversion 3D numpy tables to visual form without external dependencies.

#### Uses
- Visualize 3D numpy arrays (such as MRI, CT scans, or scientific simulations) directly within reserchers workflow without needing heavy external software. VolViz is designed to work inside Jupyter Notebook, JupyterLab, VS Code Notebooks and Google Colab.

#### Cons
- Requires separate uploading files, it's only for visualization in developer's environment, which can be too complicated for dentists.

---

#### Nora 
[nora imaging](https://www.nora-imaging.com/) 

Medical imaging platform, web-based framework for medical image analysis. Most similar to what we want to acheive, however, it's focused on brain images. UI looks similar to the one from [niivue](https://niivue.com/), but code isn't available. Was presented in [“Nora Imaging”: A Web-Based Platform for Medical Imaging](https://www.thieme-connect.com/products/ejournals/abstract/10.1055/s-0037-1602977), however just abstract is pbliclly available (on Research Gate there's just option to request authors to read full text).

It runs in any web-browser, without installation or update issues, there is also electron version of it.

This demo version enables uploading .nii file and test it: https://www.nora-imaging.org/demo/index.php?viewer

#### Uses:
- real-time image resclicing (MPR), overlays, ROIs, 3D surface rendering and connectome/fiber viewer
- viewing DICOM, NIFTI and BRUKER, showing json, jpeg, png, pdf
- can be configured with preset schemes to automatically load specific datasets with specific settings
- the viewer also works as a standalone offline tool: Without installation, simply drag and drop your local files into the browser and use all of the useful features
- labelling/segmentation (citation):
> Nora allows for interactive reading, labeling and tagging in a multi-user environment. You want to investigate whether prostate cancer can better be assessed using a combination of PET/CT or DCE MRI? Or you want to know if your automated segmentation algorithm really can support visual diagnosis of lung cancer?
Set up a project and define an interactive form with click, check, and combo-boxes. Invite your colleagues worldwide to read and rate the cases in a randomized manner and / or in multiple stages showing the data in different configurations. With this standardisation, you can get results with great statistical power.
This is not only a powerful tool for randomized surveys, but also to perform quality checks and to generate ground truth datasets with labels, annotations and regions of interest.

#### Cons
- Number of options makes it little noisy. In demo 3D rotation was working for their example, but I haven't found anything to run 3D form of our nifti image, just 2D slices. Looks like it denoises uploaded images, and supports segmentation.

---

### MRI Viewer

[MRI Viewer - github](https://github.com/epam/mriviewer)

Note: [opensourcemalware](https://opensourcemalware.com/npm/med3web) says Med3Web which is forked from mir viewer and is little behind it, includes malicious code.

#### Uses
- MRI Viewer is a high performance web tool for advanced visualization (both in 2D and 3D modes) medical volumetric data, provided in popular file formats: DICOM, NIfTI, KTX™, HDR. There is available segmentation option marked as beta version, but it's just loading and didn't get any results (at least in demo version).

#### Cons
- Main drawback is limit of file size, I wasn't able to upload any of our nifti files. Segmentation is either very slow or doesn't work.

Other limitation: It works as a standalone HTML5 web application. The latest version can be used with WebGL-enabled desktop browsers (Chrome, Firefox, Opera) and allows limited usage with mobile browsers (Android Chrome). Version for Safari (macOS, iOS) is planned for future.
 
 ---

### OHIF Viewer

[OHIF Viewer - Home Page](https://ohif.org/) [OHIF Viewer - uploader](https://viewer.ohif.org/local) [OHIF Viewer - github](https://github.com/OHIF/Viewers)

An open source, web-based, medical imaging platform. It aims to provide a core framework for building complex imaging applications.

#### Uses
- Designed to load large radiology studies as quickly as possible. Retrieves metadata ahead of time and streams in imaging pixel data as needed.
Leverages Cornerstone3D for decoding, rendering, and annotating medical images. Works out-of-the-box with Image Archives that support DICOMWeb. Provides a plugin framework for creating task-based workflow modes which can reuse core functionality. Beautiful user interface (UI) designed with extensibility in mind. UI components available in a reusable component library built with React.js and Tailwind CSS

#### Cons
- Only for DICOM.

---

### 3D Slicer

[3D Slicer website](https://www.slicer.org/)

>3D Slicer is a free, open source software for visualization, processing, segmentation, registration, and analysis of medical, biomedical, and other 3D images and meshes; and planning and navigating image-guided procedures.

#### Uses
- visualization suitable for surgical planning, algorithm development, and research, 3D view (volume rendering, real-time surgical navigation, tractography, etc.)
- AI-assisted annotation tools can automatically segment anatomical structures using pre-trained or custom models. 
- used in real-time surgical navigation
- creating surgical plans, create high-quality atlases, or training data sets for deep learning using the Segment Editor module
- importing volumes, segmentations, surfaces from FreeSurfer then edit and analyze them [YouTube example](https://discourse.slicer.org/t/new-extension-slicerfreesurfer/12751)

#### cons
- large overhead when we want to do sth more than just visualize, requires specific knowledge

####  Dental Segmentator extension
[kitware Dental Segmentator extension](https://www.kitware.com/dental-segmentator/)

The Dental Segmentator extension allows the fully automatic segmentation of 5 anatomic structures on DMF CT and CBCT scans: maxilla and upper skull, mandible, upper teeth, lower teeth, and mandibular canal.

The extension allows running the segmentation on a selected CT or CBCT volume, editing, and exporting it directly from the Dental Segmentator module.

The extension can be downloaded, installed, and used directly from 3D Slicer from the Slicer 5.7 preview release onward.


---

## End-to-end solutions:


### 3D Surgical

[3D surgical website](https://www.3dsurgical.com/)

A cloud‑based platform for end‑to‑end surgical case management, including DICOM upload, AI‑based segmentation, 3D visualization, and planning tools. MySegmenter is an FDA‑cleared automated segmentation tool.

#### Uses
- Uploading CT/CBCT DICOM scans for segmentation and planning
- Pre-operative planning workflows for hospitals and engineers
- Surgical device design, patient‑specific 3D models, and 3D printing pipelines

#### cons
- commercial/closed system: not open‑source, limited customizability
- DICOM‑only workflow, no explicit support for research formats like NIfTI
- requires external hosting, not ideal for strict on‑prem deployments

---

### Axial3D

[Axial3D Website](https://axial3d.com/)

A cloud‑based AI‑powered automated segmentation and surgical planning platform, designed for scalable patient‑specific workflows.

#### Uses
- automated segmentation from DICOM images
- pre‑surgical and orthopedic planning
- patient-specific implant design, robotic navigation, templating, and measurements
- enterprise hospital workflows needing automation and scale

#### cons
- DICOM-only pipeline, lacks support for NIfTI
- Enterprise‑grade: likely costly, locked‑down ecosystem, limited experiment flexibility
- cloud‑only: depends on AWS; not ideal for research environments lacking cloud permission

---

### Materialise Mimics Viewer

[Materialise Website](https://www.materialise.com/en/healthcare/mimics/mimics-viewer)

A web-based interactive 3D viewer for reviewing medical cases and segmented models. Includes AI-enabled segmentation and collaborative visualization tools.

#### uses
- online review of 3D anatomical models and image overlays
- basic measurements, navigation, "fly‑through" visualization
- comparison of models with underlying imaging
- academic, orthopaedic, CMF, cardiovascular planning workflows
- segmentation and labeling images for precise 3D models with AI-powered algorithms and free up time for higher-value tasks with cloud-based work

#### cons
Primarily a viewer, not a full ML training/inference backend. Commercial, limited openness and extensibility.

---

### Relu Creator

[Relu creator website](https://www.relu.ai/products/creator)

It's a cloud‑based, AI‑assisted 3D segmentation and treatment‑planning platform for dental and maxillofacial imaging. It provides fast, automated segmentation of CBCT, CT, intra‑oral scans, and supports fusion of multiple imaging modalities. 

It looks quite solid. Here there are tutorials how to use it: [YouTube](https://www.youtube.com/watch?v=jbRc9ccXPNI&list=PLg2JGIUd0kkzj35N5IZ_IEqn-EjbM1rCi&index=1)

#### uses
- described as "the #1 cloud‑based AI-assisted segmentation software for dental and maxillofacial images"
- intended for "generation of a digital model of the head & neck" and processing of medical images for visualization, segmentation, registration, and modeling
- used by dental specialists for 3D modeling and pre‑operative planning

Copied from the website:

```
Automatic segmentation of CBCT
Upload your CT or CBCT scan. Receive a 3D model of the mandible, maxilla, teeth, sinusses, airway and mandibular canals in a matter of minutes.

Automatic segmentation of digital impression
Upload a digital impression. In a matter of minutes, all the crowns will be segmented automatically.

Automatic alignment of CBCT, digital impressions and facial scan
Upload your CBCT, digital impressions and facial scans and the AI-assisted software will automatically align the different scans. The result is one virtual patient containing all the necessary information. 

Manual tools for segmentation, alignment and measurements
Manual tools allow you to adapt the automatic segmentation or to segment a structure from scratch. Next to that, there are tools available for manually aligning different scans and to make 2D and volumetric measurements.

Upload and align third-party 3D models
Add custom structures (.ply or .stl) from third-party 3D models and manually align them with the 3D model of the virtual patient. 
```

#### cons:
- it doesn't support nifti (mentioned only DICOM, STL, PLY, OBJ)
- provides segmentation results but does not expose raw AI models or allow algorithm customization
- commercial (pay per case), not open-source, not customizable
- cloud-based, not ideal for on‑premise research deployments with strict data policies

---

### CEPHX

[CEPHX Website](https://cephx.com/cbct-segmentation/)

CephX’s AI-Based Algorithm Analyzes CBCT Data To Automatically Extract and Segment Teeth, Bone and Nerve Canal. Upload DICOM Files to Your Secured Portal To Save Time, Achieve More Predictable Outcome, And Fully Utilize 3D Data Of Your Patients

Commercial one, looks really good in advertising video, but supports only dicom, not nifti.

---

### Diagnocat

[Diagnocat website](https://diagnocat.com/en)

AI-driven dental imaging platform that analyzes 2D and 3D dental images, including CBCT, panoramic X‑rays, intraoral radiographs, and more.

It generates automated radiological reports, CBCT segmentations, orthodontic reports, implant planning reports, 3D STL models, and intraoral scan superimposition.


Overall it looks mega solid on their website

#### uses
- Automated CBCT Segmentation (converts CBCT scans into anatomically accurate 3D STL models, segmentation of teeth, bone, maxilla/mandible structures, etc.)
- cephalometric and orthodontic analysis
- implant Planning
- Superimposition / Fusion (Automatically aligns intraoral scans with CBCT (3D superimposition))
- Reporting Automation (Produces detailed radiological reports in minutes for 2D and 3D files)
- Lab & Clinic Workflow Tools (used in clinics for diagnostics, patient communication, and treatment planning)

#### cons
- DICOM-centric
- Subscription‑based licensing
- Cloud‑only SaaS platform
- not customizable, closed ecosystem

---
---

Searching for apps, found also sth what can be useful for creating model:

### MIST (Medical Imaging Segmentation Toolkit)
[MIST Github](https://github.com/mist-medical/mist-tf)
An open‑source, end‑to‑end framework for 3D medical image segmentation, covering training, evaluation, and deployment pipelines.

#### uses
- standardized deep‑learning segmentation workflows for research
- reproducible benchmarking (e.g., BraTS challenges)
- multi‑GPU inference and evaluation pipelines

#### cons
- not a viewer (lacks a built‑in 3D visualization or upload UI)
- requires ML expertise and infrastructure to integrate into real applications
- More of a backend toolkit than a full end‑to‑end clinical system

---

### MedSAM2 (Segment Anything for 3D Medical Images)
[MedSam2](https://medsam2.github.io/)
[Papers](https://mist-medical.readthedocs.io/en/latest/)

A large foundation model for promptable segmentation in 3D medical images and videos, trained on 455k+ 3D image–mask pairs.

### uses
- general-purpose segmentation across CT, MRI, PET, ultrasound, endoscopy videos
- Human‑in‑the‑loop annotation pipelines
- Used inside 3D Slicer or custom inference systems.
- large multi-phase lesion annotation and multi-modality 3D datasets
- MedSAM2 consists of the classic PyTorch architecture: image encoder (PyTorch), prompt encoder, memory attention module, mask decoder (PyTorch)
- can be loaded as a PyTorch model into MONAI pipelines, can be used as an inferer in MONAI (SlidingWindowInferer, SimpleInferer, etc.), can be wrapped in MONAI transforms, can be used as a feature extractor or part of a larger pipeline

### cons
- only the segmentation model, no uploader or viewer
- Requires integration into your own ML backend + viewer (e.g., Niivue).
- high computational cost for 3D foundation models

--- 


And paper which (based on abstract) can be interesting: [Evaluating free segmentation tools for CBCT-derived models: Cost-effective solutions](https://pubmed.ncbi.nlm.nih.gov/38666318/)


---
## Very general, simplified summary

Generally, based on the reviewed solutions, our platform will be different because it is fully end‑to‑end (upload -> processing -> segmentation -> visualization) and it natively supports NIfTI files - a capability that most existing dental and CBCT‑focused applications do not offer. Will be designed specifically for CBCT tooth segmentation (unlike general viewers), supports larger files than some web viewers like Med3Web and will offer easy-to-use interface for dentist, not requiring awareness of what is inside app.

