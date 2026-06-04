# WM 2026 Player Data Fix Report

Generated: 2026-06-04T16:49:31.389Z

## Summary

- Target file: `playersData-wm2026-league1-season2026.js`
- Reference file: `data-wm2026.js`
- Player count: 1248 (reference: 1248)
- Teams: 48
- FORWARD before: 310
- FORWARD after: 0
- Position fields changed: 311
- Missing club logos before (with Club.name): 12
- Missing club logos after (with Club.name): 7
- Missing club logos after (all): 162
- Club logos filled: 5
- Cape Verde gaps ignored: 1
- Manual checkpoints still open: 9

## Validation Signals

- Duplicate player.id values in target: 0
- Unexpected field-shape entries: 0
- Invalid positions: none
- Teams not at 26 players: none
- API-Football team-search was not used; no local team-search cache/client for teams was found beyond existing data files and checked scripts require RAPIDAPI_KEY for fixture workflows.

## Special Positions

| player.id | Name | Final Position | Expected | Status |
| --- | --- | --- | --- | --- |
| 291964 | Arda Güler | MIDFIELDER | MIDFIELDER | ok |
| 644 | Leroy Sané | ATTACKER | ATTACKER | ok |

## Position Changes

| player.id | Name | Nationalteam | Before | After |
| --- | --- | --- | --- | --- |
| 635 | Riyad Mahrez | Algeria | FORWARD | ATTACKER |
| 85041 | Amine Gouiri | Algeria | FORWARD | ATTACKER |
| 326067 | Anis Hadj Moussa | Algeria | FORWARD | ATTACKER |
| 292924 | Ahmed Benbouali | Algeria | FORWARD | ATTACKER |
| 200139 | Mohammed Amoura | Algeria | FORWARD | ATTACKER |
| 329163 | Adil Boulbina | Algeria | FORWARD | ATTACKER |
| 334915 | F. Ghedjemis | Algeria | FORWARD | ATTACKER |
| 6009 | Julián Alvarez | Argentina | FORWARD | ATTACKER |
| 154 | Lionel Messi Cuccittini | Argentina | FORWARD | ATTACKER |
| 6067 | Thiago Almada | Argentina | FORWARD | ATTACKER |
| 323935 | Giuliano Simeone Baldini | Argentina | FORWARD | ATTACKER |
| 350037 | Nicolás Paz Martínez | Argentina | FORWARD | ATTACKER |
| 295513 | José López | Argentina | FORWARD | ATTACKER |
| 217 | Lautaro Martínez | Argentina | FORWARD | ATTACKER |
| 2751 | Mathew Leckie | Australia | FORWARD | ATTACKER |
| 198352 | Mohamed Touré | Australia | FORWARD | ATTACKER |
| 38123 | Ajdin Hrustić | Australia | FORWARD | ATTACKER |
| 2755 | Awer Mabil | Australia | FORWARD | ATTACKER |
| 338014 | Nestory Irankunda | Australia | FORWARD | ATTACKER |
| 342035 | Cristian Volpato | Australia | FORWARD | ATTACKER |
| 312459 | Nishan Velupillay | Australia | FORWARD | ATTACKER |
| 296645 | T. Yengi | Australia | FORWARD | ATTACKER |
| 18830 | Marko Arnautović | Austria | FORWARD | ATTACKER |
| 25297 | Michael Gregoritsch | Austria | FORWARD | ATTACKER |
| 7722 | Saša Kalajdžić | Austria | FORWARD | ATTACKER |
| 126642 | Patrick Wimmer | Austria | FORWARD | ATTACKER |
| 907 | Romelu Lukaku Bolingoli | Belgium | FORWARD | ATTACKER |
| 1946 | Leandro Trossard | Belgium | FORWARD | ATTACKER |
| 1422 | Jérémy Doku | Belgium | FORWARD | ATTACKER |
| 25458 | Dodi Lukebakio Ngandoli | Belgium | FORWARD | ATTACKER |
| 147859 | Charles De Ketelaere | Belgium | FORWARD | ATTACKER |
| 340077 | Matias Fernandez-Pardo | Belgium | FORWARD | ATTACKER |
| 314377 | S. Bazdar | Bosnia & Herzegovina | FORWARD | ATTACKER |
| 46930 | E. Demirovic | Bosnia & Herzegovina | FORWARD | ATTACKER |
| 790 | E. Dzeko | Bosnia & Herzegovina | FORWARD | ATTACKER |
| 395559 | Kerim-Sam Alajbegović | Bosnia & Herzegovina | FORWARD | ATTACKER |
| 329409 | Esmir Bajraktarević | Bosnia & Herzegovina | FORWARD | ATTACKER |
| 28382 | Haris Tabaković | Bosnia & Herzegovina | FORWARD | ATTACKER |
| 77037 | Jovo Lukić | Bosnia & Herzegovina | FORWARD | ATTACKER |
| 762 | Vinícius Paixão de Oliveira | Brazil | FORWARD | ATTACKER |
| 1165 | Matheus Carneiro da Cunha | Brazil | FORWARD | ATTACKER |
| 276 | Neymar Da Silva | Brazil | FORWARD | ATTACKER |
| 1496 | Raphael Dias Belloli | Brazil | FORWARD | ATTACKER |
| 377122 | Endrick Moreira de Sousa | Brazil | FORWARD | ATTACKER |
| 265785 | Luiz Rosa da Silva | Brazil | FORWARD | ATTACKER |
| 127769 | Gabriel Martinelli Silva | Brazil | FORWARD | ATTACKER |
| 196156 | Igor Nascimento Rodrigues | Brazil | FORWARD | ATTACKER |
| 407806 | Rayan Simplício Rocha | Brazil | FORWARD | ATTACKER |
| 2001 | C. Larin | Canada | FORWARD | ATTACKER |
| 8489 | J. David | Canada | FORWARD | ATTACKER |
| 351587 | Tanitoluwa Oluwatimikhin Oluwaseyi | Canada | FORWARD | ATTACKER |
| 51016 | Tajon Buchanan | Canada | FORWARD | ATTACKER |
| 362145 | Ali Ahmed | Canada | FORWARD | ATTACKER |
| 313353 | Promise Akinpelu | Canada | FORWARD | ATTACKER |
| 2489 | Luis Díaz Marulanda | Colombia | FORWARD | ATTACKER |
| 24810 | Jhon Córdoba Copete | Colombia | FORWARD | ATTACKER |
| 47582 | Juan Hernández Suárez | Colombia | FORWARD | ATTACKER |
| 13376 | Jaminton Campaz | Colombia | FORWARD | ATTACKER |
| 47237 | Luis Suárez Charris | Colombia | FORWARD | ATTACKER |
| 345748 | Carlos Gómez Hinestroza | Colombia | FORWARD | ATTACKER |
| 279482 | B. Cipenga | Congo DR | FORWARD | ATTACKER |
| 47545 | Gaël Kakuta Mambenga | Congo DR | FORWARD | ATTACKER |
| 3034 | Meschack Elia Lina | Congo DR | FORWARD | ATTACKER |
| 3033 | Cédric Bakambu | Congo DR | FORWARD | ATTACKER |
| 179699 | Fiston Kalala Mayele | Congo DR | FORWARD | ATTACKER |
| 20649 | Yoane Wissa | Congo DR | FORWARD | ATTACKER |
| 20674 | Simon Banza | Congo DR | FORWARD | ATTACKER |
| 275651 | Ange-Yoan Bonny | Ivory Coast | FORWARD | ATTACKER |
| 301771 | Simon Adingra | Ivory Coast | FORWARD | ATTACKER |
| 513776 | Yan Diomande | Ivory Coast | FORWARD | ATTACKER |
| 162707 | Sepe Wahi | Ivory Coast | FORWARD | ATTACKER |
| 334429 | Oumar Diakité | Ivory Coast | FORWARD | ATTACKER |
| 157997 | Amad Diallo Traoré | Ivory Coast | FORWARD | ATTACKER |
| 3246 | Nicolas Pépé | Ivory Coast | FORWARD | ATTACKER |
| 137303 | Evann Guessand | Ivory Coast | FORWARD | ATTACKER |
| 387643 | Bazoumana Touré | Ivory Coast | FORWARD | ATTACKER |
| 726 | Andrej Kramarić | Croatia | FORWARD | ATTACKER |
| 46746 | A. Budimir | Croatia | FORWARD | ATTACKER |
| 207 | I. Perisic | Croatia | FORWARD | ATTACKER |
| 202696 | Igor Matanović | Croatia | FORWARD | ATTACKER |
| 260865 | Marco Pašalić | Croatia | FORWARD | ATTACKER |
| 66055 | Petar Musa | Croatia | FORWARD | ATTACKER |
| 18981 | Jürgen Locadia | Curaçao | FORWARD | ATTACKER |
| 163220 | Jeremy Antonisse | Curaçao | FORWARD | ATTACKER |
| 161884 | Sontje Hansen | Curaçao | FORWARD | ATTACKER |
| 41627 | Kenji Gorré | Curaçao | FORWARD | ATTACKER |
| 195067 | Jearl Margaritha | Curaçao | FORWARD | ATTACKER |
| 37272 | Brandley Kuwas | Curaçao | FORWARD | ATTACKER |
| 38708 | Gervane Kastaneer | Curaçao | FORWARD | ATTACKER |
| 66019 | Adam Hložek | Czech Republic | FORWARD | ATTACKER |
| 794 | Patrik Schick | Czech Republic | FORWARD | ATTACKER |
| 66340 | Jan Kuchta | Czech Republic | FORWARD | ATTACKER |
| 66275 | Mojmír Chytil | Czech Republic | FORWARD | ATTACKER |
| 66387 | P. Sulc | Czech Republic | FORWARD | ATTACKER |
| 818 | T. Chorý | Czech Republic | FORWARD | ATTACKER |
| 290212 | Denis Višinský | Czech Republic | FORWARD | ATTACKER |
| 25414 | John Yeboah Zamora | Ecuador | FORWARD | ATTACKER |
| 361966 | Kevin Rodríguez Cortez | Ecuador | FORWARD | ATTACKER |
| 35533 | Enner Valencia Lastra | Ecuador | FORWARD | ATTACKER |
| 16590 | Jordy Caicedo Medina | Ecuador | FORWARD | ATTACKER |
| 16369 | Gonzalo Plata Jiménez | Ecuador | FORWARD | ATTACKER |
| 311543 | Nilson Angulo Ramírez | Ecuador | FORWARD | ATTACKER |
| 350799 | Jeremy Arévalo Mera | Ecuador | FORWARD | ATTACKER |
| 2664 | Mahmoud Hassan | Egypt | FORWARD | ATTACKER |
| 550547 | H. Abdelkarim | Egypt | FORWARD | ATTACKER |
| 306 | Mohamed Salah | Egypt | FORWARD | ATTACKER |
| 20844 | Haissem Hassan | Egypt | FORWARD | ATTACKER |
| 70535 | Ibrahim Hassan | Egypt | FORWARD | ATTACKER |
| 81573 | Omar Marmoush | Egypt | FORWARD | ATTACKER |
| 664079 | Ahmed Zizo | Egypt | FORWARD | ATTACKER |
| 1460 | Bukayo Saka | England | FORWARD | ATTACKER |
| 184 | Harry Kane | England | FORWARD | ATTACKER |
| 909 | Marcus Rashford | England | FORWARD | ATTACKER |
| 138787 | Anthony Gordon | England | FORWARD | ATTACKER |
| 19366 | Oliver Watkins | England | FORWARD | ATTACKER |
| 136723 | Chukwunonso Madueke | England | FORWARD | ATTACKER |
| 19974 | Ivan Toney | England | FORWARD | ATTACKER |
| 153 | Masour Dembélé | France | FORWARD | ATTACKER |
| 21509 | Marcus Thuram-Ulien | France | FORWARD | ATTACKER |
| 278 | Kylian Mbappe | France | FORWARD | ATTACKER |
| 19617 | Michael Olise | France | FORWARD | ATTACKER |
| 161904 | Bradley Barcola | France | FORWARD | ATTACKER |
| 343027 | Désiré Doué | France | FORWARD | ATTACKER |
| 25927 | J. Mateta | France | FORWARD | ATTACKER |
| 978 | Kai Havertz | Germany | FORWARD | ATTACKER |
| 158054 | Nick Woltemade | Germany | FORWARD | ATTACKER |
| 158644 | Maximilian Beier | Germany | FORWARD | ATTACKER |
| 644 | Leroy Sané | Germany | MIDFIELDER | ATTACKER |
| 26475 | Deniz Undav | Germany | FORWARD | ATTACKER |
| 303467 | Issahaku Fatawu | Ghana | FORWARD | ATTACKER |
| 3428 | Jordan Ayew | Ghana | FORWARD | ATTACKER |
| 82090 | Solomon Thomas-Asante | Ghana | FORWARD | ATTACKER |
| 411800 | Christopher Baah | Ghana | FORWARD | ATTACKER |
| 47294 | Iñaki Dannis Williams | Ghana | FORWARD | ATTACKER |
| 199837 | K. Sulemana | Ghana | FORWARD | ATTACKER |
| 350856 | E. Nuamah | Ghana | FORWARD | ATTACKER |
| 410016 | Prince Adu | Ghana | FORWARD | ATTACKER |
| 50958 | Derrick Etienne Jr. | Haiti | FORWARD | ATTACKER |
| 45020 | Duckens Nazon | Haiti | FORWARD | ATTACKER |
| 128766 | Louicius Deedson | Haiti | FORWARD | ATTACKER |
| 162733 | Ruben Providence | Haiti | FORWARD | ATTACKER |
| 21613 | Lenny Joseph | Haiti | FORWARD | ATTACKER |
| 84087 | Wilson Isidor | Haiti | FORWARD | ATTACKER |
| 48535 | Yassin Fortuné | Haiti | FORWARD | ATTACKER |
| 8601 | Frantzdy Pierrot | Haiti | FORWARD | ATTACKER |
| 174915 | Josué Casimir | Haiti | FORWARD | ATTACKER |
| 42315 | Mehdi Taremi | Iran | FORWARD | ATTACKER |
| 643918 | M. Ghaedi | Iran | FORWARD | ATTACKER |
| 29720 | Ali Alipourghara | Iran | FORWARD | ATTACKER |
| 29937 | Amirhossein Hosseinzadeh | Iran | FORWARD | ATTACKER |
| 89982 | S. Moghanlou | Iran | FORWARD | ATTACKER |
| 37892 | D. Eckert Ayensa | Iran | FORWARD | ATTACKER |
| 299813 | Ali Al Hamadi | Iraq | FORWARD | ATTACKER |
| 542697 | Meme | Iraq | FORWARD | ATTACKER |
| 229112 | Ahmed Qasem | Iraq | FORWARD | ATTACKER |
| 542842 | A. Y. Hashim | Iraq | FORWARD | ATTACKER |
| 542644 | A. Jasim | Iraq | FORWARD | ATTACKER |
| 49451 | Aymen Hussein | Iraq | FORWARD | ATTACKER |
| 265448 | Marko Farji | Iraq | FORWARD | ATTACKER |
| 375930 | Keisuke Goto | Japan | FORWARD | ATTACKER |
| 72155 | Ayase Ueda | Japan | FORWARD | ATTACKER |
| 33289 | Koki Ogawa | Japan | FORWARD | ATTACKER |
| 422572 | K. Shiogai | Japan | FORWARD | ATTACKER |
| 72142 | Mohammed Abu Zurayq | Jordan | FORWARD | ATTACKER |
| 164026 | Ali Olwan | Jordan | FORWARD | ATTACKER |
| 15286 | Mousa Sulaiman | Jordan | FORWARD | ATTACKER |
| 568556 | O. Al Fakhouri | Jordan | FORWARD | ATTACKER |
| 123530 | Mahmoud Al Mardi | Jordan | FORWARD | ATTACKER |
| 432841 | Ibrahim Abdallah Sabra | Jordan | FORWARD | ATTACKER |
| 575283 | A. Azaizeh | Jordan | FORWARD | ATTACKER |
| 186 | Heung-Min Heungmin | South Korea | FORWARD | ATTACKER |
| 34211 | Gue-Sung Cho | South Korea | FORWARD | ATTACKER |
| 34710 | Hyeon-Gyu Oh | South Korea | FORWARD | ATTACKER |
| 2887 | Raúl Jiménez Rodríguez | Mexico | FORWARD | ATTACKER |
| 2889 | Ernesto Vega Rojas | Mexico | FORWARD | ATTACKER |
| 94562 | Santiago Giménez | Mexico | FORWARD | ATTACKER |
| 291713 | Armando González Alba | Mexico | FORWARD | ATTACKER |
| 35532 | Julián Quiñones Quiñones | Mexico | FORWARD | ATTACKER |
| 36111 | César Huerta Valera | Mexico | FORWARD | ATTACKER |
| 36088 | Guillermo Martínez Ayala | Mexico | FORWARD | ATTACKER |
| 2879 | Roberto Alvarado Hernández | Mexico | FORWARD | ATTACKER |
| 36579 | Soufiane Rahimi | Morocco | FORWARD | ATTACKER |
| 744 | Brahim Díaz | Morocco | FORWARD | ATTACKER |
| 181421 | Abdessamad Ezzalzouli | Morocco | FORWARD | ATTACKER |
| 2722 | Ayoub El Kaabi | Morocco | FORWARD | ATTACKER |
| 535046 | A. Amaimouni | Morocco | FORWARD | ATTACKER |
| 25416 | Wout Weghorst | Netherlands | FORWARD | ATTACKER |
| 667 | Memphis Depay | Netherlands | FORWARD | ATTACKER |
| 247 | Cody Gakpo | Netherlands | FORWARD | ATTACKER |
| 544 | Noa Lang | Netherlands | FORWARD | ATTACKER |
| 249 | Donyell Malen | Netherlands | FORWARD | ATTACKER |
| 38750 | Brian Adjei Brobbey | Netherlands | FORWARD | ATTACKER |
| 37724 | Crysencio Summerville | Netherlands | FORWARD | ATTACKER |
| 18931 | Christopher Wood | New Zealand | FORWARD | ATTACKER |
| 6865 | Konstantinos Barbarouses | New Zealand | FORWARD | ATTACKER |
| 6938 | Benjamin Waine | New Zealand | FORWARD | ATTACKER |
| 158688 | Jesse Randall | New Zealand | FORWARD | ATTACKER |
| 8492 | Alexander Sørloth | Norway | FORWARD | ATTACKER |
| 1100 | Erling Braut Haaland | Norway | FORWARD | ATTACKER |
| 2032 | Jørgen Strand Larsen | Norway | FORWARD | ATTACKER |
| 314511 | Antonio Eromonsele | Norway | FORWARD | ATTACKER |
| 24845 | Julian Ryerson | Norway | FORWARD | ATTACKER |
| 57910 | Tomás Rodríguez Mena | Panama | FORWARD | ATTACKER |
| 2983 | José Fajardo Nelson | Panama | FORWARD | ATTACKER |
| 51648 | Cecilio Waterman Ruíz | Panama | FORWARD | ATTACKER |
| 292396 | Azarías Londoño González | Panama | FORWARD | ATTACKER |
| 2522 | A. Sanabria | Paraguay | FORWARD | ATTACKER |
| 2514 | Alejandro Romero Gamarra | Paraguay | FORWARD | ATTACKER |
| 95460 | Alex Arce Barrios | Paraguay | FORWARD | ATTACKER |
| 70747 | Julio Enciso Espínola | Paraguay | FORWARD | ATTACKER |
| 6483 | Gabriel Ávalos Stumpfs | Paraguay | FORWARD | ATTACKER |
| 70670 | Isidro Pitta Saldívar | Paraguay | FORWARD | ATTACKER |
| 874 | Cristiano Dos Santos | Portugal | FORWARD | ATTACKER |
| 41585 | Gonçalo Matias Ramos | Portugal | FORWARD | ATTACKER |
| 583 | João João Félix | Portugal | FORWARD | ATTACKER |
| 41112 | Francisco Machado de Castro | Portugal | FORWARD | ATTACKER |
| 22236 | Rafael Da Conceição | Portugal | FORWARD | ATTACKER |
| 1864 | Pedro Neto | Portugal | FORWARD | ATTACKER |
| 925 | Gonçalo Ganchinho Guedes | Portugal | FORWARD | ATTACKER |
| 161585 | Francisco Fernandes da Conceição | Portugal | FORWARD | ATTACKER |
| 2542 | Ahmed Alaa | Qatar | FORWARD | ATTACKER |
| 42075 | Edmilson Da Silva | Qatar | FORWARD | ATTACKER |
| 42089 | Mohammed Muntari | Qatar | FORWARD | ATTACKER |
| 2545 | Hassan Al Haydos | Qatar | FORWARD | ATTACKER |
| 2544 | Akram Afif | Qatar | FORWARD | ATTACKER |
| 542541 | Y. Abdurisag | Qatar | FORWARD | ATTACKER |
| 2543 | Almoez Abdulla | Qatar | FORWARD | ATTACKER |
| 423737 | Tahsin Jamshid | Qatar | FORWARD | ATTACKER |
| 283174 | Mohamed Manai | Qatar | FORWARD | ATTACKER |
| 147812 | Ayman Ahmed | Saudi Arabia | FORWARD | ATTACKER |
| 44324 | Feras Al Brikan | Saudi Arabia | FORWARD | ATTACKER |
| 44340 | Salem Al Dawsari | Saudi Arabia | FORWARD | ATTACKER |
| 44551 | Saleh Al Shehri | Saudi Arabia | FORWARD | ATTACKER |
| 44701 | Khalid Al Ghannam | Saudi Arabia | FORWARD | ATTACKER |
| 44382 | Abdullah Al Hamdan | Saudi Arabia | FORWARD | ATTACKER |
| 2639 | Sultan Mandash | Saudi Arabia | FORWARD | ATTACKER |
| 45307 | L. Dykes | Scotland | FORWARD | ATTACKER |
| 19524 | C. Adams | Scotland | FORWARD | ATTACKER |
| 45078 | Ross Stewart | Scotland | FORWARD | ATTACKER |
| 343576 | Ben Gannon Doak | Scotland | FORWARD | ATTACKER |
| 8794 | George Hirst | Scotland | FORWARD | ATTACKER |
| 45175 | Lawrence Shankland | Scotland | FORWARD | ATTACKER |
| 433272 | Findlay Curtis | Scotland | FORWARD | ATTACKER |
| 400948 | Assane Diao | Senegal | FORWARD | ATTACKER |
| 284072 | Cheikh Mbacké Dieng | Senegal | FORWARD | ATTACKER |
| 304 | Sadio Mané | Senegal | FORWARD | ATTACKER |
| 283058 | Nicolas Jackson | Senegal | FORWARD | ATTACKER |
| 14379 | Pape Ndiaye | Senegal | FORWARD | ATTACKER |
| 18592 | Iliman Baroy Ndiaye | Senegal | FORWARD | ATTACKER |
| 2218 | Ismaïla Sarr | Senegal | FORWARD | ATTACKER |
| 446249 | Ibrahim Mbaye | Senegal | FORWARD | ATTACKER |
| 179893 | Oswin Appollis | South Africa | FORWARD | ATTACKER |
| 295977 | Tshepang Moremi | South Africa | FORWARD | ATTACKER |
| 98936 | Lyle Foster | South Africa | FORWARD | ATTACKER |
| 414149 | Relebohile Mofokeng | South Africa | FORWARD | ATTACKER |
| 354831 | Thapelo Maseko | South Africa | FORWARD | ATTACKER |
| 127429 | I. Rayners | South Africa | FORWARD | ATTACKER |
| 201354 | E. Makgopa | South Africa | FORWARD | ATTACKER |
| 359561 | Kamogelo Sebelebele | South Africa | FORWARD | ATTACKER |
| 931 | Ferran Torres | Spain | FORWARD | ATTACKER |
| 1323 | Daniel Olmo Carvajal | Spain | FORWARD | ATTACKER |
| 184226 | Yeremy Pino Santos | Spain | FORWARD | ATTACKER |
| 183799 | Nicholas Williams Arthuer | Spain | FORWARD | ATTACKER |
| 386828 | Lamine Yamal | Spain | FORWARD | ATTACKER |
| 47323 | Mikel Oyarzabal | Spain | FORWARD | ATTACKER |
| 338751 | Víctor Muñoz Villanueva | Spain | FORWARD | ATTACKER |
| 47348 | Borja Iglesias Quintás | Spain | FORWARD | ATTACKER |
| 2864 | Alexander Isak | Sweden | FORWARD | ATTACKER |
| 153430 | Anthony Junior Elanga | Sweden | FORWARD | ATTACKER |
| 18979 | V. Gyökeres | Sweden | FORWARD | ATTACKER |
| 15683 | Håkan Nilsson | Sweden | FORWARD | ATTACKER |
| 160925 | Taha Ali | Sweden | FORWARD | ATTACKER |
| 421 | Breel Embolo | Switzerland | FORWARD | ATTACKER |
| 406244 | Johan Manzambi | Switzerland | FORWARD | ATTACKER |
| 48648 | Dan Ndoye | Switzerland | FORWARD | ATTACKER |
| 48471 | Rubén Vargas Martínez | Switzerland | FORWARD | ATTACKER |
| 48389 | Noah Okafor | Switzerland | FORWARD | ATTACKER |
| 123469 | Mohamed Amdouni | Switzerland | FORWARD | ATTACKER |
| 42012 | Mohamed Achouri | Tunisia | FORWARD | ATTACKER |
| 323974 | Elias Saad | Tunisia | FORWARD | ATTACKER |
| 344862 | Hazem Mastouri | Tunisia | FORWARD | ATTACKER |
| 566059 | R. Elloumi | Tunisia | FORWARD | ATTACKER |
| 2962 | F. Chaouat | Tunisia | FORWARD | ATTACKER |
| 142959 | Muhammed Aktürkoğlu | Türkiye | FORWARD | ATTACKER |
| 291964 | Arda Güler | Türkiye | FORWARD | MIDFIELDER |
| 388570 | Deniz Gül | Türkiye | FORWARD | ATTACKER |
| 339883 | Kenan Yıldız | Türkiye | FORWARD | ATTACKER |
| 49857 | İrfan Kahveci | Türkiye | FORWARD | ATTACKER |
| 454 | Yunus Akgün | Türkiye | FORWARD | ATTACKER |
| 63274 | Barış Yılmaz | Türkiye | FORWARD | ATTACKER |
| 134590 | Oğuz Aydın | Türkiye | FORWARD | ATTACKER |
| 339887 | Can Uzun | Türkiye | FORWARD | ATTACKER |
| 51617 | Darwin Núñez Ribeiro | Uruguay | FORWARD | ATTACKER |
| 70078 | Facundo Pellistri Rebollo | Uruguay | FORWARD | ATTACKER |
| 51618 | Paul Rodríguez Bravo | Uruguay | FORWARD | ATTACKER |
| 16482 | Rodrigo Aguirre Soto | Uruguay | FORWARD | ATTACKER |
| 51530 | Federico Viñas Barboza | Uruguay | FORWARD | ATTACKER |
| 51466 | J. Piquerez | Uruguay | FORWARD | ATTACKER |
| 73868 | Ricardo Pepi | USA | FORWARD | ATTACKER |
| 17 | Christian Pulišić | USA | FORWARD | ATTACKER |
| 50739 | Brenden Aaronson | USA | FORWARD | ATTACKER |
| 427 | Haji Wright | USA | FORWARD | ATTACKER |
| 138835 | Folarin Balogun | USA | FORWARD | ATTACKER |
| 1138 | Timothy Tarpeh Weah | USA | FORWARD | ATTACKER |
| 35885 | Alejandro Zendejas Saavedra | USA | FORWARD | ATTACKER |
| 53535 | Eldor Azamat Shomurodov | Uzbekistan | FORWARD | ATTACKER |
| 65584 | Azizbek Amonov | Uzbekistan | FORWARD | ATTACKER |
| 72128 | I. Sergeev | Uzbekistan | FORWARD | ATTACKER |
| 309182 | Gilson Benchimol Tavares | Cape Verde Islands | FORWARD | ATTACKER |
| 343287 | Dailon Rocha do Rosario | Cape Verde Islands | FORWARD | ATTACKER |
| 50270 | Ryan Mendes da Graça | Cape Verde Islands | FORWARD | ATTACKER |

## Filled Club Logos

| Spielername | player.id | Nationalteam | Club.name | Club.logo | Source | Confidence | Detail |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Christopher Baah | 411800 | Ghana | Al Qadsiah FC | https://media.api-sports.io/football/teams/2933.png | club-name-map | high | normalized club: al qadsiah fc |
| Kojo Peprah | 404172 | Ghana | OGC Nice | https://media.api-sports.io/football/teams/84.png | club-name-map | high | normalized club: ogc nice |
| Hee-Chan Heechan | 24888 | South Korea | Wolverhampton Wanderers FC | https://media.api-sports.io/football/teams/39.png | club-name-map | high | normalized club: wolverhampton wanderers fc |
| Bilal El Khannouss | 340573 | Morocco | VfB Stuttgart | https://media.api-sports.io/football/teams/172.png | club-name-map | high | normalized club: vfb stuttgart |
| David Møller Wolfe | 265782 | Norway | Wolverhampton Wanderers FC | https://media.api-sports.io/football/teams/39.png | same-player-old-file | high | old club: Wolverhampton Wanderers FC |

## Still Missing Club Logos

| Spielername | player.id | Nationalteam | Club.name | Reason |
| --- | --- | --- | --- | --- |
| L. Zidane | 732 | Algeria |  | empty-club-name |
| Y. Titraoui | 327599 | Algeria |  | empty-club-name |
| F. Ghedjemis | 334915 | Algeria |  | empty-club-name |
| S. Chergui | 20869 | Algeria |  | empty-club-name |
| J. Musso | 2465 | Argentina |  | empty-club-name |
| L. Balerdi | 6 | Argentina |  | empty-club-name |
| Lucas Herrington | 426480 | Australia |  | empty-club-name |
| T. Yengi | 296645 | Australia |  | empty-club-name |
| A. Schlager | 7525 | Austria |  | empty-club-name |
| D. Affengruber | 126640 | Austria |  | empty-club-name |
| K. Danso | 25287 | Austria |  | empty-club-name |
| X. Schlager | 1095 | Austria |  | empty-club-name |
| B. Tahirovic | 264094 | Bosnia & Herzegovina |  | empty-club-name |
| A. Dedic | 7318 | Bosnia & Herzegovina |  | empty-club-name |
| A. Gigovic | 70514 | Bosnia & Herzegovina |  | empty-club-name |
| S. Bazdar | 314377 | Bosnia & Herzegovina |  | empty-club-name |
| E. Demirovic | 46930 | Bosnia & Herzegovina |  | empty-club-name |
| E. Dzeko | 790 | Bosnia & Herzegovina |  | empty-club-name |
| J. Waterman | 78494 | Canada |  | empty-club-name |
| M. Choinière | 50788 | Canada |  | empty-club-name |
| S. Eustáquio | 35570 | Canada |  | empty-club-name |
| I. Koné | 328046 | Canada |  | empty-club-name |
| C. Larin | 2001 | Canada |  | empty-club-name |
| J. David | 8489 | Canada |  | empty-club-name |
| A. Tuanzebe | 19182 | Congo DR |  | empty-club-name |
| D. Batubinsika | 8445 | Congo DR |  | empty-club-name |
| N. Mukau | 375598 | Congo DR |  | empty-club-name |
| N. Mbuku | 129670 | Congo DR |  | empty-club-name |
| S. Moutoussamy | 21101 | Congo DR |  | empty-club-name |
| B. Cipenga | 279482 | Congo DR |  | empty-club-name |
| Andrej Kramarić | 726 | Croatia |  | empty-club-name |
| L. Modric | 754 | Croatia |  | empty-club-name |
| A. Budimir | 46746 | Croatia |  | empty-club-name |
| I. Pandur | 14268 | Croatia |  | empty-club-name |
| N. Vlasic | 842 | Croatia |  | empty-club-name |
| I. Perisic | 207 | Croatia |  | empty-club-name |
| D. Jurásek | 128793 | Czech Republic |  | empty-club-name |
| P. Sulc | 66387 | Czech Republic |  | empty-club-name |
| J. Stanek | 66347 | Czech Republic |  | empty-club-name |
| L. Provod | 66353 | Czech Republic |  | empty-club-name |
| M. Sadílek | 241 | Czech Republic |  | empty-club-name |
| T. Chorý | 818 | Czech Republic |  | empty-club-name |
| Ahmed Fatouh | 2649 | Egypt |  | empty-club-name |
| Hamdi Fathy | 16813 | Egypt |  | empty-club-name |
| Karim Hafez | 2656 | Egypt |  | empty-club-name |
| Al Mahdi Soliman | 16831 | Egypt |  | empty-club-name |
| Mohanad Lasheen | 16841 | Egypt |  | empty-club-name |
| Nabil Emad Dunga | 2660 | Egypt |  | empty-club-name |
| Ahmed Zizo | 664079 | Egypt |  | empty-club-name |
| M. Alaa | 550469 | Egypt |  | empty-club-name |
| J. Mateta | 25927 | France |  | empty-club-name |
| R. Risser | 347211 | France |  | empty-club-name |
| R. Cherki | 156477 | France |  | empty-club-name |
| M. Akliouche | 274300 | France |  | empty-club-name |
| M. Lacroix | 20995 | France |  | empty-club-name |
| M. Neuer | 497 | Germany |  | empty-club-name |
| Caleb Marfo Yirenkyi | 475575 | Ghana | FC Nordsjælland | no-safe-logo-match |
| Iñaki Dannis Williams | 47294 | Ghana |  | empty-club-name |
| A. Boakye | 337426 | Ghana |  | empty-club-name |
| K. Sulemana | 199837 | Ghana |  | empty-club-name |
| D. Luckassen | 25341 | Ghana |  | empty-club-name |
| E. Nuamah | 350856 | Ghana |  | empty-club-name |
| C. F. Sainte | 540857 | Haiti |  | empty-club-name |
| M. Ghaedi | 643918 | Iran |  | empty-club-name |
| Aria Yousefi | 343405 | Iran |  | empty-club-name |
| Amirhossein Hosseinzadeh | 29937 | Iran |  | empty-club-name |
| A. Nemati | 533035 | Iran |  | empty-club-name |
| S. Moghanlou | 89982 | Iran |  | empty-club-name |
| M. Ghorbani | 341844 | Iran |  | empty-club-name |
| H. Hosseini | 29755 | Iran |  | empty-club-name |
| D. Eiri | 532950 | Iran |  | empty-club-name |
| Fahad Talib | 123802 | Iraq | Al Talaba SC | no-safe-logo-match |
| Meme | 542697 | Iraq |  | empty-club-name |
| A. Y. Hashim | 542842 | Iraq |  | empty-club-name |
| Aymen Hussein | 49451 | Iraq | Al Karma SC | no-safe-logo-match |
| Z. Ismaeel | 626479 | Iraq |  | empty-club-name |
| Kaishu Sano | 33889 | Japan |  | empty-club-name |
| Junnosuke Suzuki | 351014 | Japan | FC København | no-safe-logo-match |
| K. Shiogai | 422572 | Japan |  | empty-club-name |
| Yazid Abu Layla | 140607 | Jordan |  | empty-club-name |
| M. Abu Hasheesh | 542710 | Jordan |  | empty-club-name |
| Abdallah Naseeb | 310835 | Jordan |  | empty-club-name |
| H. Abu Al Dahab | 542822 | Jordan |  | empty-club-name |
| O. Al Fakhouri | 568556 | Jordan |  | empty-club-name |
| Ibrahim Sa'deh | 542768 | Jordan |  | empty-club-name |
| M. Al Daoud | 651096 | Jordan |  | empty-club-name |
| A. Badawi | 664028 | Jordan |  | empty-club-name |
| Heung-Min Heungmin | 186 | South Korea | LAFC | no-safe-logo-match |
| Cho Wi-Je | 547307 | South Korea |  | empty-club-name |
| Young-Woo Seol | 197985 | South Korea |  | empty-club-name |
| J. Castrop | 280358 | South Korea |  | empty-club-name |
| Kim Jin-Gyu | 34168 | South Korea |  | empty-club-name |
| Eom Ji-Sung | 237050 | South Korea |  | empty-club-name |
| Lee Dong-Gyeong | 34431 | South Korea |  | empty-club-name |
| J. Rangel | 270774 | Mexico |  | empty-club-name |
| Ayoub El Kaabi | 2722 | Morocco | Olympiacos FC | no-safe-logo-match |
| A. Amaimouni | 535046 | Morocco |  | empty-club-name |
| A. Tagnaouti | 2703 | Morocco |  | empty-club-name |
| N. El Aynaoui | 277003 | Morocco |  | empty-club-name |
| Tyler Bindon | 430835 | New Zealand | Sheffield United FC | no-safe-logo-match |
| M. Woud | 36777 | New Zealand |  | empty-club-name |
| R. Thomas | 242 | New Zealand |  | empty-club-name |
| C. Elliot | 6932 | New Zealand |  | empty-club-name |
| L. Bayliss | 405957 | New Zealand |  | empty-club-name |
| T. Smith | 51307 | New Zealand |  | empty-club-name |
| Ø. Nyland | 19172 | Norway |  | empty-club-name |
| C. Martinez | 554208 | Panama |  | empty-club-name |
| R. Fernandez | 535737 | Paraguay |  | empty-club-name |
| J. Cáceres | 195992 | Paraguay |  | empty-club-name |
| F. Balbuena | 2500 | Paraguay |  | empty-club-name |
| J. Alonso | 2499 | Paraguay |  | empty-club-name |
| R. Sosa | 196298 | Paraguay |  | empty-club-name |
| Mahmud Ibrahim Abunada | 42207 | Qatar |  | empty-club-name |
| Pedro Miguel | 2530 | Qatar |  | empty-club-name |
| Lucas Mendes | 42288 | Qatar |  | empty-club-name |
| G. Laye | 542536 | Qatar |  | empty-club-name |
| Jassem Gaber | 200981 | Qatar |  | empty-club-name |
| Abdulaziz Hatem | 2533 | Qatar |  | empty-club-name |
| A. Al Oui | 542548 | Qatar |  | empty-club-name |
| A. Al Hussain | 542542 | Qatar |  | empty-club-name |
| Ala Al Haji | 593759 | Saudi Arabia |  | empty-club-name |
| J. Thakri | 543059 | Saudi Arabia |  | empty-club-name |
| Scott McTominay | 903 | Scotland |  | empty-club-name |
| G. Hanley | 19066 | Scotland |  | empty-club-name |
| K. Tierney | 1117 | Scotland |  | empty-club-name |
| J. McGinn | 19191 | Scotland |  | empty-club-name |
| T. Fletcher | 557460 | Scotland |  | empty-club-name |
| L. Dykes | 45307 | Scotland |  | empty-club-name |
| Thapelo Maseko | 354831 | South Africa |  | empty-club-name |
| Sphephelo Sithole | 158433 | South Africa |  | empty-club-name |
| M. Mbokazi | 510799 | South Africa |  | empty-club-name |
| I. Rayners | 127429 | South Africa |  | empty-club-name |
| S. Chaine | 46417 | South Africa |  | empty-club-name |
| E. Makgopa | 201354 | South Africa |  | empty-club-name |
| Anthony Junior Elanga | 153430 | Sweden |  | empty-club-name |
| V. Johansson | 158700 | Sweden |  | empty-club-name |
| K. Sema | 2860 | Sweden |  | empty-club-name |
| H. Ekdal | 47903 | Sweden |  | empty-club-name |
| C. Starfelt | 47988 | Sweden |  | empty-club-name |
| J. Karlström | 48047 | Sweden |  | empty-club-name |
| C. Abdelmouhib | 533394 | Tunisia |  | empty-club-name |
| Rani Khedira | 25300 | Tunisia |  | empty-club-name |
| K. Ayari | 533295 | Tunisia |  | empty-club-name |
| H. Mahmoud | 67195 | Tunisia |  | empty-club-name |
| A. Dahmen | 49424 | Tunisia |  | empty-club-name |
| E. Skhiri | 21587 | Tunisia |  | empty-club-name |
| R. Elloumi | 566059 | Tunisia |  | empty-club-name |
| R. Chikhaoui | 533360 | Tunisia |  | empty-club-name |
| Federico Viñas Barboza | 51530 | Uruguay |  | empty-club-name |
| J. Piquerez | 51466 | Uruguay |  | empty-club-name |
| F. Muslera | 429 | Uruguay |  | empty-club-name |
| S. Bueno | 135334 | Uruguay |  | empty-club-name |
| J. Sanabria | 162891 | Uruguay |  | empty-club-name |
| R. Zalazar | 108563 | Uruguay |  | empty-club-name |
| F. Sayfiev | 532759 | Uzbekistan |  | empty-club-name |
| A. Abdullaev | 416952 | Uzbekistan |  | empty-club-name |
| Azizbek Amonov | 65584 | Uzbekistan |  | empty-club-name |
| I. Sergeev | 72128 | Uzbekistan |  | empty-club-name |
| A. Fayzullaev | 263676 | Uzbekistan |  | empty-club-name |
| S. Esanov | 363723 | Uzbekistan |  | empty-club-name |
| B. Karimov | 416964 | Uzbekistan |  | empty-club-name |
| A. Ulmasaliev | 65571 | Uzbekistan |  | empty-club-name |

## Cape Verde Gaps Ignored

| player.id | Spielername | Field |
| --- | --- | --- |
| 308689 | Sidny Lopes Cabral | Gewicht |

## Ambiguous Club Names

_Keine._

## ID Special Case 753 / 37127

| File | player.id | Record |
| --- | --- | --- |
| old data-wm2026.js | 753 | Martin Ødegaard \| Norway \| Arsenal \| MIDFIELDER |
| target playersData | 753 | Marcos Llorente Moreno \| Spain \| Atletico Madrid \| DEFENDER |
| target playersData | 37127 | Martin Ødegaard \| Norway \| Arsenal \| MIDFIELDER |


No duplicate player.id values were found in the target file.

Recommendation: no automatic ID correction was applied. The target file is internally consistent for these IDs if the table above reflects the intended identities.

## Tahith Chong / Kenji Gorre Check

| File | player.id | Record |
| --- | --- | --- |
| old data-wm2026.js | 906 | Tahith Chong \| Curaçao \| Luton \| MIDFIELDER |
| old data-wm2026.js | 41627 | Kenji Gorré \| Curaçao \| Maccabi Haifa \| ATTACKER |
| target playersData | 906 | Tahith Chong \| Curaçao \| Luton \| MIDFIELDER |
| target playersData | 41627 | Kenji Gorré \| Curaçao \| Maccabi Haifa \| ATTACKER |


Recommendation: no automatic identity correction was applied; the local old/new records are reported above for manual review.

## Manual Seed Logos

| Club group | Aliases | Logo |
| --- | --- | --- |
| Borussia Dortmund | Borussia Dortmund; BVB | https://media.api-sports.io/football/teams/165.png |
| Bayer Leverkusen | Bayer Leverkusen; Bayer 04 Leverkusen | https://media.api-sports.io/football/teams/168.png |
| Real Madrid | Real Madrid C. F.; Real Madrid CF; Real Madrid | https://media.api-sports.io/football/teams/541.png |
| Esperance Tunis | Esperance De Tunisie; Esperance Tunis; ES Tunis | https://media.api-sports.io/football/teams/980.png |
| Al Duhail SC | Al Duhail SC; Al-Duhail SC; Al Duhail | https://media.api-sports.io/football/teams/2904.png |
| Granada CF | Granada CF; Granada | https://media.api-sports.io/football/teams/715.png |


## Notes

- Club names were not changed.
- Missing weights were not filled.
- Empty Cape Verde values are listed above but are not treated as blockers.
- Logo decisions were limited to same-player old-file matches, unique club-name mappings, alias mappings, or the task-provided manual seeds.
- Original player count used during this run: 1248.
