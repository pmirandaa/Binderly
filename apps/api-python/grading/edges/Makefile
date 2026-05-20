# Edges sub-grade model Makefile
#
# Targets:
#   train     — train the model on available labelled data
#   eval      — evaluate a trained ONNX model
#   export    — export model parameters to ONNX
#   test      — run pytest tests for this module
#   clean     — remove build artefacts

PYTHON ?= python
MODEL_OUT ?= edges_v0.onnx
EPOCHS ?= 30
LR ?= 0.001
PATCH_SIZE ?= 64

.PHONY: train eval export test clean

train:
	$(PYTHON) -m grading.edges.train \
		--epochs $(EPOCHS) \
		--lr $(LR) \
		--patch-size $(PATCH_SIZE) \
		--output $(MODEL_OUT)

eval:
	$(PYTHON) -m grading.edges.eval \
		--model $(MODEL_OUT) \
		--patch-size $(PATCH_SIZE)

export:
	$(PYTHON) -m grading.edges.export \
		--params edges_params.npz \
		--input-dim $$((4 * $(PATCH_SIZE) * $(PATCH_SIZE) * 3)) \
		--output $(MODEL_OUT)

test:
	pytest -q grading/edges/tests/

clean:
	rm -f edges_v0.onnx edges_params.npz
