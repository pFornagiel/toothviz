**Wariant A: Obliczenia w 100% Lokalne (Wszystko dzieje się na PC dentysty)**

W tym scenariuszu dostarczamy aplikację (np. Electron + wbudowany Python), która nie potrzebuje internetu do działania, ale w pełni polega na sprzęcie w gabinecie.

**1. Ryzyko: Zbyt duże wymagania pamięciowe (Out of Memory - RAM)**

- **Opis:** Pliki NIfTI ważące po 100 MB po rozpakowaniu do trójwymiarowej macierzy w pamięci operacyjnej drastycznie rosną. W połączeniu z wagami modelu 3D, standardowe komputery biurowe (z 8 GB RAM) mogą po prostu "ubić" proces z braku pamięci.
- **Rozwiązanie:** Wdrożenie technik optymalizacyjnych podczas inferencji (np. _Sliding Window Inference_ w MONAI, które tnie obraz na małe klocki). Ewentualne narzucenie wymagań minimalnych (np. 16 GB RAM) lub w ostateczności przejście na Wariant B.

**2. Ryzyko: Bardzo długi czas wnioskowania na procesorze (CPU)**

- **Opis:** Brak dedykowanej karty graficznej (GPU) u dentysty sprawi, że czas potrzebny na segmentację jednego wolumenu może wynosić od 1 do nawet kilku minut, co wywoła frustrację użytkownika.
- **Rozwiązanie:** Po pierwsze: konwersja modelu z czystego PyTorcha do formatu **ONNX Runtime** (znacznie przyspiesza działanie na CPU). Po drugie: UX – pasek postępu.

**3. Ryzyko: Blokady przez zaporę sieciową (Firewall / Inbound Ports)**

- **Opis:** Jeśli lokalny backend Pythonowy (FastAPI) otworzy port nasłuchujący na komputerze (np. localhost:8000), zapory sieciowe i antywirusy mogą wyrzucić alert o potencjalnym wirusie.
- **Rozwiązanie:** Enkapsulacja w środowisko Electron, ewentualnie instrukcja jak wyłączyć zabezpieczenia Windowsowe. Bez uprawnień administratora na komputerze pewnie się nie obejdzie.

**Wariant B: Zewnętrzny Serwer Obliczeniowy (Electron tylko jako klient)**

W tym scenariuszu na komputerze dentysty działa tylko "lekki" interfejs, który wysyła zapytania do naszej maszyny w chmurze/serwerowni.

**1. Ryzyko: Wąskie gardło sieciowe i długi czas przesyłu**

- **Opis:** Gabinety stomatologiczne często mają asymetryczne łącza internetowe (słaby upload). Przesłanie 100 MB pliku może zająć więcej czasu niż sama inferencja na serwerze z GPU.
- **Rozwiązanie:** Informowanie dentysty o progresie wysyłania plików poprzez pasek postępu (Upload Progress Bar) w UI. Przetwarzanie asynchroniczne – dentysta może przeglądać inne zakładki w aplikacji, gdy plik "leci" w tle.

**2. Ryzyko: Kwestie RODO i prywatność pacjentów**

- **Opis:** Wysłanie skanu poza komputer lekarza na Twój serwer rodzi ogromne ryzyko prawne w przypadku wycieku danych medycznych.
- **Rozwiązanie:** Skrypt wewnątrz Electrona (zanim wyśle plik w sieć) musi zignorować oryginalną nazwę pliku (często zawierającą nazwisko pacjenta) i wysłać na serwer sam czysty wolumen NIfTI podpisany wyłącznie losowym, anonimowym identyfikatorem (UUID).

**3. Ryzyko: Koszty i utrzymanie infrastruktury serwerowej**

- **Opis:** Utrzymywanie w chmurze serwera obliczeniowego bogatego w pamięć RAM i wyposażonego w dedykowane GPU jest bardzo drogie (np. setki dolarów miesięcznie na AWS/GCP).
- **Rozwiązanie:** Kosztów nie da się uniknąć w produkcji. Na etapie developmentu można korzystać z darmowych zasobów.

**Ryzyka Ogólne (Wspólne dla obu wariantów)**

**1. Ryzyko: Zbyt niska jakość segmentacji modelu**

- **Opis:** Nasz autorski model może okazać się za słaby i generować bezużyteczne maski poszczególnych zębów.
- **Rozwiązanie:** Użyjemy dostępnych rozwiązań segmentacji z internetu i lekko dostosujemy je do naszych potrzeb.

**2. Ryzyko: Zacinająca się wizualizacja 3D w interfejsie**

- **Opis:** Renderowanie dużego wolumenu skanu wraz z nałożoną na niego maską może powodować spadki płynności (klatkowanie) w aplikacji.
- **Rozwiązanie:** Zastosowanie biblioteki NiiVue, która jest doskonale zoptymalizowana pod WebGL.