"""Errors raised while turning a DICOM upload into a volume."""

from __future__ import annotations


class DicomConversionError(ValueError):
    """The upload cannot be converted; the message is shown to the user as-is.

    Messages must say what is wrong with the upload and, where possible, how to
    fix it. They must not contain directory names from the archive, which often
    carry patient names; file base names are fine.
    """
