"""add upload support columns

Revision ID: 002
Revises: 001
Create Date: 2026-02-26
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "conversion_jobs",
        sa.Column("client_ip", sa.String(45), nullable=True),
    )
    op.add_column(
        "conversion_jobs",
        sa.Column("source_type", sa.String(10), server_default="url", nullable=False),
    )
    op.add_column(
        "conversion_jobs",
        sa.Column("original_filename", sa.String(255), nullable=True),
    )
    op.alter_column(
        "conversion_jobs",
        "source_url",
        existing_type=sa.Text(),
        nullable=True,
    )
    op.create_index("ix_conversion_jobs_client_ip", "conversion_jobs", ["client_ip"])


def downgrade() -> None:
    op.drop_index("ix_conversion_jobs_client_ip", table_name="conversion_jobs")
    op.alter_column(
        "conversion_jobs",
        "source_url",
        existing_type=sa.Text(),
        nullable=False,
    )
    op.drop_column("conversion_jobs", "original_filename")
    op.drop_column("conversion_jobs", "source_type")
    op.drop_column("conversion_jobs", "client_ip")
