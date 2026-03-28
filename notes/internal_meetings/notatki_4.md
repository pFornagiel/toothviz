Spotkanie z Prof. Czekierdą 18.03.2026

Flow użytkownika:
- Zastanowić się odnośnie tego, w jaki sposób użytkownik (dentysta) będzie wchodził w interakcje z aplikacją - które opcje będą mu udostępniane i w jakiej kolejności
-  Uściślenie tego co zostało przedstawione na prezentacji (i tablicy) podczas spotkania

Skala Housfielda:
- powinniśmy ustalić, czy po segmentacji będzie dostępna skala Hounsfielda i w jaki sposób (jeśli wogóle) chcemy umiżliwiać użytkownikowi jej konfiguracje

Kwestia modelu odszumiania:
- Uznaliśmy, że min. odszumianie zdjęć, mimo że rozwiązuje prawdziw problem, to obszar, co do którego nie mamy pewności czy zrealizujemy. Zastasnowić się, czy chcemy to ujmować w pracy i jeżeli tak - trzeba poprawnie opisać to w analizie ryzyka, nie jest blokerem względem reszty aplikacji
- W analizie ryzyka należy dodatkowo uwzględnić i rozpisać, które elementy aplikacji są kluczowe i jakie ryzyko wiąże się z brakiem ich realizacji
- Min. uwzględnić coś o datasecie i dostępności danych

Badanie wydajności:
- Trzeba zbadać wydajność wizualizacji i ustalić sobie w pracy jakieś cele (metryki wydajności) oraz założenia odnośnie sprzętu komputerowego, który będzie ją wykonywał
- Podobnie z segmentacją (forward passem modelu) - tutaj czekamy na informacje od dr Brodzickiego, aby lepiej wyestymować

Istniejące rozwiązania
- mamy już rozpisane, trzeba przenieść wiedzę na pracę inżynierską
- nasz przypadek: na pdostawie orzmowy z klientem dokonaliśmy analizy rozwiązań dostępnych na rynku, aby zaproponować rozwiązanie, które nie jest 1:1 istniejącym
- nasze założenie: lightweight, prosta aplikacja służąca do wizualizacji i segmentacji, darmowa i open-source, aby ktoś zdoświadczeniem technicznym mógł ją ewentualnie rozszerzyć wedle swoich potrzeb
- inspiracje - napisać min. o 3DSlicerze, że nie chcemy tak skomplikowanego interfejsu, wpsomnieć też o NiiVue i o przykładach implementacji interfejsu, z których możemy wziąść inspiracje
- screenshoty istniejących rozwiązań powinny też znaleźć się w pracy

Konwersja DICOM -> NIFTI:
- możemy dokonywać konwersji, trzeba uzasadnić czemu tylko w jedną stronę, dlaczego i po co