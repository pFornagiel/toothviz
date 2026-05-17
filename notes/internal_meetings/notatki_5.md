### Spotkanie z prof. Czekierdą 14.04.2026, 18:15

## Kwestie okołoprawne
### Kwestie prawne-prawne
- Kwestia przechowywania danych pacjenta i anonimizacji. Czy pliki NIFTI/DICOM zawierają informacje poufne, czy podczas konwersji plików te dane są zachowywane.


### Kwestie licencyjne
- Na jakiej licencji udostępniamy software - czy zawieramy w planie deploy, czy udostępniamy po prostu rozwiązanie. Zamysł: licencja otwartoźródłowa typu MIT z modelem software-as-is.


## Lekarz experience
- Czy chcemy grupować pacjentów w foldery, czy pozwalamy na dodatkowe notatki dla pacjenta
- Przemyśleć co dokładnie lekarz powinien móc przechowywać i na jakiej zasadzie identyfikować poszczególne skany
- Kwestia przemianowania "Studium" na inną, bardziej przyjazną i oczywistą dla lekarza nazwę
- Dodefiniowanie user-stories

## Showoff aplikacji
- Zaprezentowaliśmy pierwszy dokument opisujący strukturę aplikacji - RFC #1, na podstawie którego później będzie można tworzyć 3 rozdział pracy inżynierskiej
- Pokazaliśmy wstępną wersję aplikacji od strony zarówno "backendu" jak i interfejsu lekarza
- Domyślnie nie oddajemy opcji batchowego przesyłania, ale to kwestia do rozważenia - na razie zamysłem było pojedyncze przetwarzanie zdjęć, zgodnie z prośbą klienta

## Lokalne vs Rozproszone
- Poruszyliśmy kwestie, że możliwie model nie doliczy się lokalnie na komputerze lekarza i należy zbadać wykonalność i rozważyć opcję rozproszenia aplikacji

## Wizualizacja
- Doprecyzowaliśmy kwestie "wycinek" obrazka z dr Brodzickim - zoom na wyznaczony obszar / ograniczenie pola roboczego

## Kwestia AI
- Ustaliliśmy, ze zorientujemy się w oficjalnym stanowisku AGH odnośnie użycia AI w pracy inżynierskiej 

## Zmiana tematu na angielski
- Zmieniono temat pracy na angielski

## Plan na najbliższe spotkanie
- research: rozpraszalność, wykonalność modelu lokalnie, kwestie prawne odnośnie plików NIFTI
- implementacja: wizualizacja 3D (Łukasz), modele (Emil), aplikacja (Paweł)
- postęp nad pracą inżynierską (Kasia)
- Dr Brodzicki miał dać przykładowe prace inżynierskie za zgodą do wglądu



# Wnioski po spotkaniu
## Design aplikacji 
- Po udanej analizie wykonania modelu na CPU zdecydowaliśmy nie rozpraszaca architektury - wykonanie pozostaje lokalne
- Raport z wykonania modelu na CPU - plik ML.pdf
- Wizualizacja - plik ...
- poprawki aplikacji i refactory
- nierozwiązana kwestia: grupowanie i odpowiednie nazewnictwo "studiów"

## Uzycie AI
- plik AI_usage.md
- Do przedyskutowania z promotorem / klientem - wstępnie brak zastrzezeń

## Postęp pisania pracy
- Zaczęliśmy przenosic na overleaf
- Został dopisany krótki wstęp do rozwinięcia wraz z analizą istniejących rozwiązań
- Potrzeba analizy takze rozwiązań ML - modeli, uzasadnienia dlaczego wytworzenie rozwiązania lekkiego jest sensowne
