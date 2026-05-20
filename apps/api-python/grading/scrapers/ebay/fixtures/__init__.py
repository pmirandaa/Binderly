"""Synthetic eBay Finding API fixture responses for mock/test mode.

Each ``.json`` file is a plausible ``findCompletedItems`` response covering
a distinct test vector:

- ``psa_10_charizard.json`` — PSA 10, USD, high-value gem-mint slab
- ``bgs_9_5_venusaur.json`` — BGS 9.5, USD, with sub-grades in title
- ``cgc_8_blastoise.json`` — CGC 8, USD, mid-grade slab
- ``sgc_9_pikachu.json`` — SGC 9, USD
- ``unknown_grader.json`` — No grading company keyword → OTHER
- ``misgraded_title.json`` — ``PSA`` present but no adjacent grade token
- ``gbp_currency.json`` — BGS 9.5, GBP (non-USD currency)
"""
