# MemeBag economic simulator

Le simulateur compare l’analyse exacte du pool avec un Monte-Carlo pondéré.

```powershell
python .\simulation\simulate.py
python .\simulation\simulate.py --scenario mixed --draws 500000 --json
python -m unittest discover -s .\simulation -p 'test_*.py'
```

`liquidatable_value_wei` représente la valeur nette réellement liquidable du Bag, après slippage et coûts hors protocole. Cette valeur n’est jamais utilisée par les contrats ; elle existe uniquement dans le modèle économique.

Le premier modèle est statique : les tirages utilisent le même pool avec remplacement afin de comparer proprement Monte-Carlo et formules analytiques. La prochaine itération ajoutera le remplacement dynamique des positions, les repricings, les bots et le fee farming.
