"""A small, from-scratch, learned text relevance encoder."""
import torch
from torch import nn
from torch.nn import functional as F

from features import EMBEDDING_DIM, FEATURE_DIM


class RelevanceEncoder(nn.Module):
    def __init__(self):
        super().__init__()
        self.first = nn.Linear(FEATURE_DIM, 128, bias=False)
        self.second = nn.Linear(128, EMBEDDING_DIM, bias=False)

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        return F.normalize(self.second(torch.tanh(self.first(features))), dim=-1, eps=1e-8)
