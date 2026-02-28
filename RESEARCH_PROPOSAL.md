# Research and Architecture Proposal: Web-Based CBCT Image Analysis System

[Segmentacja kanalika w żuchwie z UNet-3D](https://www.researchgate.net/publication/386338289_Location_Matters_Harnessing_Spatial_Information_to_Enhance_the_Segmentation_of_the_Inferior_Alveolar_Canal_in_CBCTs)

## 1. Executive Summary

This document outlines the proposed architecture and research strategy for a web-based Cone Beam Computed Tomography (CBCT) 3D medical image analysis system. The primary objective is to build a robust platform that leverages advanced Deep Learning—specifically Diffusion Models for image denoising and 3D segmentation networks for anatomical isolation—to process dental NIFTI (`.nii.gz`) files.

Given the heavy computational requirements of 3D volumetric processing, the system is designed around an asynchronous, microservices-based web stack. This approach ensures that intensive machine learning tasks are handled efficiently in the background, providing a seamless, responsive 3D visualization experience for the user in the browser.

## 2. System Architecture & Technology Stack

Processing large volumetric datasets (often ranging from 100MB to over 1GB per scan) synchronously within a standard web request lifecycle is unfeasible. Therefore, an asynchronous architecture is mandatory.

### 2.1 Frontend: React.js
*   **Role:** A lightweight Single Page Application (SPA) serving as the user interface.
*   **Technology:** [React.js](https://react.dev/)

### 2.2 3D Visualization: NiiVue vs. Cornerstone3D

Selecting the right WebGL viewer is critical for performance and development speed.

*   **NiiVue** ([GitHub](https://github.com/niivue/niivue) | [Docs](https://niivue.github.io/niivue/))
    *   **Pros:**
        *   *Extremely Lightweight:* Purpose-built for NIFTI formats using WebGL 2.0.
        *   *Performance:* Renders massive volumetric datasets very quickly directly within the browser.
        *   *Simplicity:* Straightforward to embed into modern React component structures.
        *   *Features:* Multi-Planar Reconstruction (MPR) and volume rendering are supported out-of-the-box with minimal setup.
    *   **Cons:**
        *   *Scope Limitations:* Strictly focused on neuroimaging formats (NIFTI). If future requirements demand native raw DICOM folder support or enterprise PACS integration, NiiVue is less capable.
        *   *Ecosystem:* Possesses a smaller community and fewer enterprise-grade plugins compared to OHIF/Cornerstone.

*   **Cornerstone3D** ([GitHub](https://github.com/cornerstonejs/cornerstone3D) | [Docs](https://www.cornerstonejs.org/))
    *   **Pros:**
        *   *Enterprise Standard:* The industry benchmark for web-based medical imaging viewers.
        *   *DICOM Native:* Flawlessly handles raw DICOM files, WADO-RS streaming, and complex metadata.
        *   *Advanced Tooling:* Offers a massive ecosystem of measurement tools, advanced segmentation brush tools, and synchronization capabilities across viewports.
    *   **Cons:**
        *   *Heavyweight:* Features a highly complex architecture with a steep learning curve.
        *   *Overkill:* For a project specifically targeting NIFTI outputs from an ML pipeline (rather than raw DICOM streaming from a hospital PACS), Cornerstone adds unnecessary bloat and significant development overhead.

*   **Conclusion:** **NiiVue** is the recommended choice for this specific project scope due to its speed, lightweight nature, and ease of integration with the `.nii.gz` files outputted by our ML pipelines.

### 2.3 Backend API & Task Management

*   **Backend API: FastAPI (Python)** ([Documentation](https://fastapi.tiangolo.com/))
    *   **Role:** High-performance, async-native Python framework. It manages file uploads, user authentication, serves metadata, and acts as the bridge between the React UI and the backend ML workers.
*   **Asynchronous Task Queue: Celery + Redis** ([Celery Docs](https://docs.celeryq.dev/) | [Redis Docs](https://redis.io/docs/))
    *   **Role:** Crucial for preventing HTTP timeouts. Standard web requests typically timeout after ~30 seconds. Processing a 3D NIFTI file through a Diffusion Model can take several minutes. FastAPI offloads these heavy jobs to a Celery Message Queue (using Redis as the broker). Dedicated background GPU-worker nodes process the tasks and notify the frontend (via WebSockets or polling) upon completion.
*   **Storage:**
    *   **Database:** PostgreSQL for relational data (user sessions, task metadata, job status).
    *   **Blob Storage:** Local file system or an S3-compatible object store (like MinIO) for storing the heavy `.nii.gz` files safely outside the database.

## 3. Machine Learning Capabilities & Model Development

Developing models for 3D medical imaging requires strategies to overcome significant hardware constraints, primarily GPU VRAM limitations and the spatial inconsistencies inherent in medical scan data.

### 3.1 What We Are Capable Of (Methodologies)

*   **Handling VRAM Limits:** Standard 3D CBCT scans are too large to fit into standard GPU memory (e.g., a 24GB RTX 3090/4090) during training. We handle this via:
    *   **Patch-based Training:** Randomly cropping smaller 3D volumes (e.g., $96 \times 96 \times 96$ voxels) from the main scan during the training phase.
    *   **Sliding Window Inference:** Stitching these patches back together seamlessly during inference (using MONAI's `SlidingWindowInferer`).
*   **Data Standardization:** Medical data varies significantly between scanner manufacturers. We utilize dynamic pre-processing pipelines:
    *   *Isotropic Resampling:* Ensuring voxel spacing is uniform across all dimensions (e.g., resizing to $0.4mm \times 0.4mm \times 0.4mm$).
    *   *Intensity Normalization:* Clipping Hounsfield Units (HU) to ranges specific to dental tissues (e.g., -1000 to +3000 for bone/enamel) and scaling the values to [0, 1].
    *   *Orientation Standardization:* Forcing all scans into a standard anatomical orientation (e.g., RAS or LPS).
*   **Memory Optimization:** Implementing Automatic Mixed Precision (AMP) to train models in FP16 instead of FP32. This effectively halves memory consumption, allowing for larger batch sizes or patch sizes.

### 3.2 Core ML Frameworks Comparison

Selecting the right framework dictates the speed of research and ease of deployment.

*   **MONAI (Medical Open Network for AI)** ([Website](https://monai.io/) | [GitHub](https://github.com/Project-MONAI/MONAI))
    *   **Pros:** Built specifically for healthcare imaging on top of PyTorch. Offers a massive library of medical-specific transforms (spacing, orientation, intensity), state-of-the-art architectures (UNETR, V-Net, Swin UNETR), and domain-specific metrics (Hausdorff Distance, Surface Dice). Highly modular. Crucially, it contains the `MONAI Generative` extension required for Diffusion models.
    *   **Cons:** Has a steeper learning curve than raw PyTorch for basic tasks, and the extensive API can sometimes obscure the underlying PyTorch mechanics.
*   **nnU-Net** ([GitHub](https://github.com/MIC-DKFZ/nnUNet))
    *   **Pros:** Provides "out-of-the-box" state-of-the-art segmentation. It automatically configures preprocessing, network architecture, training, and post-processing based entirely on the dataset's properties. Requires almost zero hyperparameter tuning.
    *   **Cons:** Highly rigid structure. It is difficult to modify the core architecture or integrate non-standard tasks (such as generative diffusion for denoising). It is best used strictly for standard segmentation tasks where maximum baseline performance is needed rapidly.
*   **Pure PyTorch** ([Website](https://pytorch.org/))
    *   **Pros:** Maximum flexibility. Necessary only if implementing completely novel, cutting-edge architectures not yet supported by MONAI.
    *   **Cons:** Writing 3D medical data loaders, spatial transforms, and sliding-window inference logic from scratch is incredibly time-consuming, complex, and error-prone.
*   **Conclusion:** **MONAI** is the recommended primary framework. It provides the necessary 3D medical tooling while retaining enough flexibility to implement both Segmentation and Generative Diffusion models within the same unified codebase.

## 4. Primary Machine Learning Targets

### 4.1 CBCT Denoising via Diffusion Models
*   **Clinical Goal:** Metal Artifact Reduction (MAR) and Scatter Radiation correction. Dental implants and amalgam fillings create severe "starburst" artifacts in CBCTs that obscure surrounding anatomy, making diagnosis difficult.
*   **Methodology (Denoising Diffusion Probabilistic Models - DDPM):**
    *   Instead of traditional GANs—which often suffer from mode collapse and hallucination (a dangerous flaw in medical imaging)—Diffusion Models learn to reverse a gradual noising process.
    *   By conditioning the diffusion model on the noisy/artifact-ridden CBCT scan, it generates a clean, high-fidelity restoration of the underlying anatomy *without* hallucinating false structures.
*   **Reference:** [Score-Based Generative Modeling in Medical Imaging](https://arxiv.org/abs/2111.08005)

### 4.2 Tooth Instance Segmentation
*   **Clinical Goal:** Automatically identifying, masking, and classifying individual teeth (e.g., using the FDI World Dental Federation notation).
*   **Methodology:**
    *   Utilizing architectures like **Swin UNETR** (Transformers for 3D medical images) or a standard **3D U-Net**.
    *   Loss calculation typically involves a combination of Dice Loss (optimizing for volume overlap) and Cross-Entropy Loss (for background vs. foreground classification).

## 5. Additional Fields in Dental NIFTI Processing (Future Scope)

Once the base architecture (Web UI -> FastAPI -> Celery -> MONAI Worker) is established, the pipeline can be easily extended to support other high-value clinical targets:

1.  **Inferior Alveolar Nerve (IAN) Canal Tracing:** Critical for dental implant surgery planning to avoid severing the nerve. This is treated as a specialized thin-tube segmentation task.
2.  **Cephalometric Landmark Detection:** Automating the detection of 3D coordinate points (e.g., Sella, Nasion) for orthodontic treatment planning and facial symmetry analysis, utilizing regression-based CNNs.
3.  **Pathology & Lesion Detection:** Identifying periapical lesions, radicular cysts, or analyzing complex root canal morphology automatically.
4.  **Alveolar Bone Segmentation:** Quantifying bone loss around tooth roots to aid in Periodontitis assessment.
5.  **Caries (Cavity) Detection:** Volumetric segmentation of decayed tissue to assess the depth and volume of the cavity relative to the dental pulp chamber.

## 6. Transfer Learning Strategy & Data Sources

Training deep 3D models from scratch requires thousands of expertly annotated scans and weeks of GPU compute time. **Transfer Learning** is the most efficient and practical approach: utilizing models pre-trained on massive, generalized medical datasets, and fine-tuning their weights on specific, smaller dental datasets.

### 6.1 Recommended Sources for Transfer Learning

1.  **MONAI Model Zoo:** ([Link](https://monai.io/model-zoo.html))
    *   Provides pre-trained weights for architectures like Swin UNETR and 3D U-Net, trained on massive multi-organ datasets (e.g., BTCV). Fine-tuning these weights on dental CBCTs converges significantly faster and achieves higher accuracy than random initialization.
2.  **nnU-Net Pre-trained Models:** ([GitHub](https://github.com/MIC-DKFZ/nnUNet))
    *   Adapting nnU-Net's generalized pre-trained weights for tooth segmentation provides an exceptionally strong, out-of-the-box baseline.
3.  **Medical Segmentation Decathlon (MSD):** ([Website](http://medicaldecathlon.com/))
    *   While not strictly dental data, pre-training models on this highly diverse set of 10 tasks allows the network to learn robust 3D spatial feature extraction techniques before fine-tuning on CBCTs.

### 6.2 Notable Dental-Specific Public Datasets (For Fine-Tuning)

To perform the final transfer learning step, the following datasets are highly valuable for fine-tuning our models to the dental domain:
*   **MICCAI STS (Tooth Segmentation Challenge):** A primary, high-quality dataset specifically curated for 3D tooth instance segmentation on CBCT scans.
*   **CVS (Caries and Various Structures):** Specialized datasets focusing on various pathologies and structures within dental scans.
