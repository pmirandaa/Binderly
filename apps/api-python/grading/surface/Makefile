# Surface sub-grade model Makefile
#
# Targets:
#   train     — train the model on available labelled data
#   eval      — evaluate a trained ONNX model
#   export    — export model parameters to ONNX
#   test      — run pytest tests for this module
#   clean     — remove build artefacts

PYTHON ?= python
MODEL_OUT ?= surface_v0.onnx
EPOCHS ?= 30
LR ?= 0.001
PATCH_SIZE ?= 64
NUM_SHOTS ?= 2

.PHONY: train eval export test clean

train:
	$(PYTHON) -m grading.surface.train \
		--epochs $(EPOCHS) \
		--lr $(LR) \
		--patch-size $(PATCH_SIZE) \
		--num-shots $(NUM_SHOTS) \
		--output $(MODEL_OUT)

eval:
	$(PYTHON) -m grading.surface.eval \
		--model $(MODEL_OUT) \
		--patch-size $(PATCH_SIZE) \
		--num-shots $(NUM_SHOTS)

export:
	$(PYTHON) -m grading.surface.export \
		--params surface_params.npz \
		--input-dim $$(($(NUM_SHOTS) * $(PATCH_SIZE) * $(PATCH_SIZE) * 3)) \
		--output $(MODEL_OUT)

test:
	pytest -q grading/surface/tests/

clean:
	rm -f surface_v0.onnx surface_params.npz
