### Źródła rzeczy

Główne źródła w projekcie wykorzystane:
- [2.5D Learning](https://www.barnacle.ai/blog/2025-11-19-william-2) - bardzo dobrze napisany i rzetelny artykuł
- [Wprowadzenie do CNN](https://stanford.edu/~shervine/teaching/cs-230/cheatsheet-convolutional-neural-networks/)
- [Paper nnUNet](https://arxiv.org/abs/1809.10486) - bardzo przyjemnie się czyta
- [nnUNet github](https://github.com/mic-dkfz/nnunet)
- [Extending nnUNet is all you need paper](https://arxiv.org/abs/2208.10791) - gostki opisują jak sobie podrasowali nnUNet do swoich potrzeb
- [Paper MobileNet](https://arxiv.org/abs/1704.04861) - sensownie się czyta, czat też dobrze tłumaczy
- [Segmentation Models Pytroch](https://github.com/qubvel-org/segmentation_models.pytorch) - encodery MobileNet z których tutaj korzystamy

Propozycja od czata jak sie zabrać za ten nnUNet:
*Suggested reading order if you want the shortest path to "I understand enough to start coding": nnU-Net paper → explanation_plans_files.md → extending_nnunet.md → dynamic-network-architectures source → MobileNetV2 paper → segmentation_models.pytorch source/docs → the fetal-head fine-tuning paper for strategy. That covers pipeline, planning, extension mechanism, target architecture (nnU-Net side), source architecture (MobileNet side), a working reference glue implementation, and fine-tuning strategy, in that order.*

Nie trzeba totalnie wszystkiego, te dwa papery o nnUNetie są spoko, reszta z czatem do obgadania.

Rzeczy, które pewnie warto obczaić:
- [Focal Loss](https://medium.com/visionwizard/understanding-focal-loss-a-quick-read-b914422913e7), [Artykuł drugi](https://www.ultralytics.com/glossary/focal-loss#real-world-applications) - model jak narazie używa funkcji straty *CrossEntropy - DICE*. Można pomyśleć o Focal Loss jako alternatywy.
- [Paper 2.5D architektury z atencją](https://arxiv.org/abs/2405.00130) - ogólnie atencja się nie tyczy tylko modeli językowych, więc może coś się z tego przydać. [Tutaj github z tego papera](https://github.com/mirthAI/CSA-Nets)
- [Kolejny paper o różnych metodach 2.5D](https://arxiv.org/pdf/2010.06163)
- [Mechanizmy atencji w obrazkach](https://medium.com/@indroneelroy83/how-attention-mechanisms-are-revolutionizing-medical-image-segmentation-part-1-classical-fe8b165131a0)

### DentVoxel Dataset
https://figshare.com/articles/dataset/DentVoxel_a_fully_annotated_dental_CBCT_dataset_with_38_instance_anatomical_structures/31239889?file=66611297

Całkiem nowy dataset, to co pokzywałem.

### [MlinPL Call for Contributors](https://conference.mlinpl.org/2026/call-for-contributions)

### [Repozytorium z modelem](https://github.com/pFornagiel/nnunet_test)

Rzeczy w które warto się zagłębić (możecie potraktować jako taski):
- **Porównanie modeli / architektur**:
    - **Plain 2D Unet** sprawdzenie na necie czy istnieją jakieś gotowe wagi + architektura, jeśli nie, po ulepszeniu naszej infrastruktury można wytrenować basicowy UNET (albo już teraz dla porównania) i sprawdzić jak się sprawuje.
    - **Pozbycie się informacji z innych warstw** - po prostu puścić UNET bez dostarczania wyższych / niższych warstw tak jak jest to robione aktualnie
    - **MobileNet without pretraining** - sprawdzić, czy da się wziąść MobileNet i trenować od zera - czy ten sam model bez wytrenowanego uprzednio korpusu będzie znacznie gorszy
- **Zmiany w pipelinie**:
    - Focal Loss lub inna funkcja straty, ewaluacji, etc.
    - Inne embedowanie danych - użycie w ramach trzech channelów skali hounsfielda i dodanie kdoowanie spatialnego (featerów 3D) w inny sposób niż dotychczas
    - Inne modele, dodawanie atencji, etc.
    - Doczytanie co jest warte wykorzystania w segmentacji zębów jeśli chodzi o takie informacje spacjalne, skale hounsfielda
- **Przeglądnięcie datasetu**:
    - stwierdzenie, jakie istnieją patologiczne przypadki
    - wyprintowanie sobie jakiejś confusion matrix na policzonych maskach, dowiedzenie się na czym model się myli i w których miejscach można poprawić jego działanie - analiza przypadków które mamy
    - poczytanie jak ludzie się z tym zmagają, z czym modele mają problemy
    - spróbowanie dołączenia większej ilości labelów - plomby, mosty, itd.
    - próba jakeigoś lepszego embedowania featerów bazując na tym co pisze na necie - skal hounsfielda, różne widoki, wycinanie jakichś części obrazów, itd.
- **Obróbka obrazów, aby były mniejsze**:
    - heurystyczne wycinanie niepotrzebncyh części niezawierających zębów żeby obliczyć labele