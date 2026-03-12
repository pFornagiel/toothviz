Spotkanie z Dr Brodzickim 12.03.2026

Przekazaliśmy informację z Pracowni Projektowej, doprecyzowaliśmy poniższe kwestie:
- Klienci docelowi
    - Lekarze stomatolodzy - Ortodontyści oraz Ertodontości, których interesuje, odpowiednio, możliwość wizualizacji całości uzębienia oraz detalów w przybliżeniu
    - Naukowcy / Research - wizualizacja, praca z plikami (drugorzędny cel)

- Zasadnicze cele projektu:
    - Aplikacja:
        - Wizualizacja całości uzębienia, ułożenia zębów pomiędzy sobą
        - Wyświetlenie detali, możliwość przybliżenia
        - Płynne działanie pod kątem wizualizacji
    - Zakres ML:
        - Segmentacja 0:1 (oddzielenie zębów od reszty szczęki)
        - Segmentacja 1:32 (wyodrębnienie poszczególnych zębów z labelami)
        - Odszumianie (model dyfuzyjny)

    Nie jest oczywiste, że będziemy w stanie zrealizować wszystkie 3 założenia dotyczące ML - należy ująć to w analizie ryzyka i pod koniec pracy - w podsumowaniu (czy udało się, czy nie)

- Flow aplikacji:
    - użytkownik (dentysta) wgrywa plik
    - możliwość wyświetlenia pliku oraz segmentacji
    - po dokonaniu segmentacji -> pokazanie wyniku użytkownikowi w sposób przystępny, patrz wyżej w celach

- Architektura
    - Lokalna ewaluacja modelu (wybrane podejście):
        - Doktor Brodzicki ma zapytać o rozwiązania osób z którymi pracuje, można ująć w analizie ryzyka / wykonalności wnioski
        - Maszyna, która uruchamia frontend również ma za zadanie zewaulować model, bez wysyłania do zewnętrznych serwerów / chmury
    - Zdalny serwer obliczeniowy (nie realizujemy):
        - szybsza ewaluacja modelu
        - wiele problemów z przesyłem, hostingiem, etc.
    - Technologia "frontend" - Electron zamiast aplikacja webowej
    
    
    Trzeba opisać pros i cons każdego z rozwiązań

- Wiedza domenowa, sekcja "słowniczek pojęć"
    - skupić się na technologii wykonania zdjęcia
    - metody segmentacji (instance segmentation vs segmentation)
    - pliki NIFTI / DICOM
    - Tomografia komputerowa / stożkowa
    - skala housfielda
    - (ewentualnie, gdzie koniecznie) anatomia zęba

- Kwestia do zbadania - wybór modelu do ewaluacji dla naukowców (raczej nie będziemy w to brnąć)

- Możliwe, że dostaniemy do wglądu pryzkładowe prace inżynierskie, do ustalenia

- Będziemy pisać w języki angielskim

