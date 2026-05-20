# Aggregate stage Makefile.
#
# Targets:
#   train     — (placeholder) print a hint until #FU-48 lands the learned-
#               calibration path. v1 weights are priors, not trained.
#   eval      — run the synthetic-data eval smoke
#   export    — export the linear aggregator to ONNX
#   test      — run pytest tests for this module
#   clean     — remove build artefacts

PYTHON ?= python
MODEL_OUT ?= aggregate_v0.onnx

.PHONY: train eval export test clean

train:
	@echo "aggregate/train: v1 weights are priors, not trained."
	@echo "Learned-calibration upgrade path is logged as #FU-48 in status.md."
	@echo "Once labelled grading sessions are available, run:"
	@echo "  AGGREGATE_USE_TORCH=1 python -m grading.aggregate.train ..."

eval:
	$(PYTHON) -m grading.aggregate.eval

export:
	$(PYTHON) -m grading.aggregate.export --output $(MODEL_OUT)

test:
	pytest -q grading/aggregate/tests/

clean:
	rm -f aggregate_v0.onnx aggregate_params.npz
