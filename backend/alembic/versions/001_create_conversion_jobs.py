"""create conversion_jobs table

Revision ID: 001
Revises:
Create Date: 2026-02-23
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "conversion_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("source_url", sa.Text(), nullable=False),
        sa.Column("input_format", sa.String(20), nullable=True),
        sa.Column("output_format", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), server_default="pending"),
        sa.Column("progress_percent", sa.Integer(), server_default="0"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("downloaded_file_path", sa.Text(), nullable=True),
        sa.Column("converted_file_path", sa.Text(), nullable=True),
        sa.Column("file_size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("conversion_jobs")
